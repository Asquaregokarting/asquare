/* eslint-disable react-refresh/only-export-components */
import { useRef } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { fmtLongDate } from '../format'

interface DateStepperProps {
  date: string
  onChange: (date: string) => void
  /** YYYY-MM-DD upper bound — defaults to today (no future browsing). */
  maxDate?: string
}

/**
 * Add `days` to a YYYY-MM-DD date. Pure calendar arithmetic in UTC —
 * avoids the local-time parse bug that previously made `+1` a no-op
 * and `-1` skip two days for IST users. Negative offsets work too.
 *
 * Old impl parsed `${iso}T00:00:00` as LOCAL time (IST), then read back
 * `.toISOString().slice(0,10)` which is UTC — that's 5.5 hours behind,
 * shifting the rendered "next day" / "previous day" by an extra day.
 */
export const shiftDateBy = (iso: string, days: number): string => {
  const parts = iso.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso
  const ts = Date.UTC(parts[0], parts[1] - 1, parts[2]) + days * 86_400_000
  return new Date(ts).toISOString().slice(0, 10)
}

/** Today as YYYY-MM-DD in IST (Asia/Kolkata) — not UTC. The UTC fallback
 *  would render "yesterday" for the 5.5 hours between IST midnight and
 *  05:30 AM, capping the stepper's forward button one day behind reality. */
const todayIso = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

/**
 * Visual date stepper. Keyboard shortcuts (←/→/T) are handled centrally by
 * the hub's useDailyReportsHotkeys dispatcher, not here, so they don't
 * race with other global keys when overlays are open.
 */
export const DateStepper = ({ date, onChange, maxDate }: DateStepperProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const cap = maxDate ?? todayIso()
  const isToday = date === cap
  const canStepForward = date < cap

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Previous day"
        title="Previous day · ←"
        onClick={() => onChange(shiftDateBy(date, -1))}
        className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-panel text-muted transition-colors hover:text-text hover:border-text/30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div
        className="relative flex h-9 items-center gap-2 rounded-lg border border-border bg-panel px-3 cursor-pointer"
        // Wrapper handles mouse/touch — it calls showPicker() explicitly
        // because Safari / iOS often refuses to open the native picker
        // when the underlying input is fully transparent. The input
        // itself is still keyboard-focusable (Tab → Space/Enter opens
        // the native picker via the browser's built-in behavior on
        // type="date") so we don't add role="button" here (which would
        // nest interactives and confuse screen readers). The visible
        // children carry pointer-events-none so every mouse click hits
        // the wrapper, not the icon/text.
        onClick={() => {
          const el = inputRef.current
          if (!el) return
          try {
            const maybe = el as HTMLInputElement & { showPicker?: () => void }
            if (typeof maybe.showPicker === 'function') {
              maybe.showPicker()
              return
            }
          } catch {
            /* showPicker throws outside a user gesture or on unsupported browsers */
          }
          el.focus()
          el.click()
        }}
      >
        <Calendar className="h-3.5 w-3.5 text-muted pointer-events-none" />
        <span className="dr-date-display pointer-events-none">{fmtLongDate(date)}</span>
        {isToday && (
          <span className="rounded-md border border-info/40 bg-info/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-info pointer-events-none">
            Today
          </span>
        )}
        <input
          ref={inputRef}
          type="date"
          value={date}
          max={cap}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value)
          }}
          // Visually hidden but kept keyboard-focusable. pointer-events-none
          // funnels mouse clicks to the wrapper (which calls showPicker),
          // while keyboard navigation still reaches the input — Tab to
          // focus, Space/Enter opens the native picker.
          className="absolute inset-0 opacity-0 pointer-events-none"
          aria-label="Pick a date"
        />
      </div>

      <button
        type="button"
        aria-label="Next day"
        title="Next day · →"
        onClick={() => canStepForward && onChange(shiftDateBy(date, 1))}
        disabled={!canStepForward}
        className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-panel text-muted transition-colors hover:text-text hover:border-text/30 disabled:opacity-40 disabled:hover:text-muted"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(cap)}
          className="ml-1 rounded-lg border border-border bg-panel px-3 text-xs font-medium text-muted transition-colors hover:text-text hover:border-text/30"
          title="Jump to today · T"
        >
          Today
        </button>
      )}
    </div>
  )
}
