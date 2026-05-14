import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getEventDailyCounts } from '../services/eventDailyCounts'

type Status = 'available' | 'fast-filling' | 'full' | 'unavailable'

interface DateCell {
  iso: string
  dayNum: string
  dayName: string
  monthLabel: string
  status: Status
  count: number
  isToday: boolean
}

interface Props {
  eventId: string
  startDate: string
  endDate: string
  dailyCapacity?: number
  selected: string
  onSelect: (iso: string) => void
}

const DEFAULT_CAPACITY = 50
const FAST_FILLING_RATIO = 0.65

const todayIso = (): string => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

const buildDateList = (start: string, end: string): string[] => {
  if (!start || !end || start > end) return []
  const result: string[] = []
  const [sy, sm, sd] = start.split('-').map(Number)
  const current = new Date(Date.UTC(sy, sm - 1, sd))
  const [ey, em, ed] = end.split('-').map(Number)
  const last = new Date(Date.UTC(ey, em - 1, ed))
  while (current <= last) {
    const y = current.getUTCFullYear()
    const m = String(current.getUTCMonth() + 1).padStart(2, '0')
    const d = String(current.getUTCDate()).padStart(2, '0')
    result.push(`${y}-${m}-${d}`)
    current.setUTCDate(current.getUTCDate() + 1)
    if (result.length > 180) break // safety cap
  }
  return result
}

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return {
    dayNum: String(d),
    dayName: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    monthLabel: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
  }
}

const STATUS_STYLES: Record<
  Status,
  { pill: string; pillText: string; card: string; label: string }
> = {
  available: {
    pill: 'bg-emerald-500/15 border-emerald-400/30',
    pillText: 'text-emerald-300',
    card: 'border-white/10 hover:border-emerald-400/40 hover:bg-emerald-400/5',
    label: 'Available',
  },
  'fast-filling': {
    pill: 'bg-amber-500/20 border-amber-400/40',
    pillText: 'text-amber-300',
    card: 'border-amber-400/30 hover:border-amber-300/60 hover:bg-amber-400/5',
    label: 'Fast Filling',
  },
  full: {
    pill: 'bg-red-500/20 border-red-400/40',
    pillText: 'text-red-300',
    card: 'border-red-500/30 opacity-60 cursor-not-allowed',
    label: 'Full',
  },
  unavailable: {
    pill: 'bg-white/5 border-white/10',
    pillText: 'text-dark-500',
    card: 'border-white/5 opacity-40 cursor-not-allowed',
    label: 'Not available',
  },
}

export default function EventDateCarousel({
  eventId,
  startDate,
  endDate,
  dailyCapacity,
  selected,
  onSelect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})

  const dates = useMemo(() => buildDateList(startDate, endDate), [startDate, endDate])

  useEffect(() => {
    if (!eventId || dates.length === 0) return
    let cancelled = false
    void getEventDailyCounts(eventId, dates).then((result) => {
      if (!cancelled) setCounts(result)
    })
    return () => {
      cancelled = true
    }
  }, [eventId, dates])

  const today = todayIso()
  const capacity = dailyCapacity && dailyCapacity > 0 ? dailyCapacity : DEFAULT_CAPACITY

  const cells: DateCell[] = useMemo(() => {
    return dates.map((iso) => {
      const count = counts[iso] ?? 0
      let status: Status
      if (iso < today) status = 'unavailable'
      else if (count >= capacity) status = 'full'
      else if (count >= capacity * FAST_FILLING_RATIO) status = 'fast-filling'
      else status = 'available'
      return {
        iso,
        ...parts(iso),
        status,
        count,
        isToday: iso === today,
      }
    })
  }, [dates, counts, today, capacity])

  const scroll = (dir: 'prev' | 'next') => {
    const el = scrollRef.current
    if (!el) return
    const delta = dir === 'next' ? el.clientWidth * 0.75 : -el.clientWidth * 0.75
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }

  if (cells.length === 0) return null

  return (
    <div className="mt-5 w-full max-w-[650px] min-w-0 overflow-hidden">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-white">Pick your date</h3>
        <div className="hidden gap-1.5 sm:flex">
          <button
            type="button"
            aria-label="Previous dates"
            onClick={() => scroll('prev')}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-dark-900/80 text-white/70 transition hover:border-primary-400/50 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Next dates"
            onClick={() => scroll('next')}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-dark-900/80 text-white/70 transition hover:border-primary-400/50 hover:text-white"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto pb-2 no-scrollbar scroll-smooth"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {cells.map((cell) => {
            const styles = STATUS_STYLES[cell.status]
            const disabled = cell.status === 'full' || cell.status === 'unavailable'
            const isSelected = cell.iso === selected
            return (
              <motion.button
                key={cell.iso}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onSelect(cell.iso)}
                whileTap={!disabled ? { scale: 0.96 } : undefined}
                className={[
                  'relative flex-shrink-0 flex flex-col items-center gap-0.5 rounded-xl border bg-dark-900/60 px-2.5 py-2 transition-all',
                  'w-[64px]',
                  styles.card,
                  isSelected && !disabled
                    ? 'ring-2 ring-primary-500 border-primary-400 bg-primary-500/10 shadow-md shadow-primary-500/20'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ scrollSnapAlign: 'start' }}
              >
                {cell.isToday && (
                  <span className="absolute -top-1.5 rounded-full bg-primary-500 px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-wide text-white shadow">
                    Now
                  </span>
                )}
                <span
                  className={`text-[9px] font-semibold uppercase tracking-wider ${
                    isSelected ? 'text-primary-300' : 'text-dark-400'
                  }`}
                >
                  {cell.dayName}
                </span>
                <span
                  className={`text-lg font-bold leading-none ${
                    disabled ? 'text-dark-500' : 'text-white'
                  }`}
                >
                  {cell.dayNum}
                </span>
                <span
                  className={`text-[8px] font-medium uppercase tracking-wider ${
                    isSelected ? 'text-primary-300' : 'text-dark-500'
                  }`}
                >
                  {cell.monthLabel}
                </span>
                <span
                  className={`mt-1 h-1.5 w-1.5 rounded-full ${
                    cell.status === 'available'
                      ? 'bg-emerald-400'
                      : cell.status === 'fast-filling'
                        ? 'bg-amber-400'
                        : cell.status === 'full'
                          ? 'bg-red-400'
                          : 'bg-white/20'
                  }`}
                  title={styles.label}
                />
              </motion.button>
            )
          })}
        </div>

        {/* Fade edges */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-dark-900 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-dark-900 to-transparent" />
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-dark-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> Fast filling
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-400" /> Full
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white/30" /> Not available
        </span>
      </div>
    </div>
  )
}
