import { useState, useEffect, useMemo, useCallback } from 'react'
import SEO from '../components/SEO'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Loader2, AlertCircle, Flag, CheckCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useBooking } from '../contexts/BookingContext'
import {
  KART_TYPES,
  subscribeAllWaitingLists,
  getSlotCounts,
  type WaitingSlot,
  type WaitingListResponse,
} from '../services/waitingListService'
import { resolveLocation } from '../lib/locations'
import { fmtTimeShortIST } from '../lib/date-format'

// ─── Constants & helpers ──────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(3, '0')

const formatTimeAgo = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}

/**
 * Average gap (in minutes) between the last ~10 completions across all karts.
 * Returns null if we don't have enough data to draw a confident estimate.
 */
const avgCompletionGapMinutes = (allSlots: WaitingSlot[]): number | null => {
  const done = allSlots
    .filter((s): s is WaitingSlot & { completedAt: string } => !!s.completedAt)
    .map((s) => new Date(s.completedAt).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => b - a)
    .slice(0, 10)
  if (done.length < 2) return null
  const gaps: number[] = []
  for (let i = 0; i < done.length - 1; i++) gaps.push(done[i] - done[i + 1])
  const avgMs = gaps.reduce((a, b) => a + b, 0) / gaps.length
  return Math.max(1, Math.round(avgMs / 60000))
}

// ─── Kart palette ──────────────────────────────────────────────────────

interface KartPalette {
  gradient: string
  text: string
  chip: string
  chipBorder: string
  cellFill: string
  cellDim: string
  dot: string
  letter: string
}

const KART_PALETTE: Record<number, KartPalette> = {
  1: {
    // Child — primary blue
    gradient: 'from-blue-500 to-cyan-500',
    text: 'text-blue-400',
    chip: 'bg-blue-500/15',
    chipBorder: 'border-blue-500/30',
    cellFill: 'bg-blue-500',
    cellDim: 'bg-blue-500/20',
    dot: 'bg-blue-400',
    letter: 'C',
  },
  2: {
    // Adult — secondary orange
    gradient: 'from-orange-500 to-red-500',
    text: 'text-orange-400',
    chip: 'bg-orange-500/15',
    chipBorder: 'border-orange-500/30',
    cellFill: 'bg-orange-500',
    cellDim: 'bg-orange-500/20',
    dot: 'bg-orange-400',
    letter: 'A',
  },
  3: {
    // Double — purple
    gradient: 'from-purple-500 to-pink-500',
    text: 'text-purple-400',
    chip: 'bg-purple-500/15',
    chipBorder: 'border-purple-500/30',
    cellFill: 'bg-purple-500',
    cellDim: 'bg-purple-500/20',
    dot: 'bg-purple-400',
    letter: 'D',
  },
}

// ─── Data shapes ──────────────────────────────────────────────────────

interface KartQueueData {
  gameSerialNumber: number
  data: WaitingListResponse | null
}

interface RecentFinish {
  srno: number
  gameSerialNumber: number
  completedAt: string
  kartName: string
}

// ─── Now Running Hero ─────────────────────────────────────────────────

const NowRunningHero = ({
  queueData,
  avgWaitMin,
  totalWaiting,
  hasData,
}: {
  queueData: KartQueueData[]
  avgWaitMin: number | null
  totalWaiting: number
  hasData: boolean
}) => {
  const navigate = useNavigate()

  // Empty-state variant — replaces the standalone "No Active Rides" block.
  if (!hasData) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-dark-800 via-dark-900 to-dark-950 p-6"
      >
        <div className="checkered-pattern absolute -right-2 -top-2 h-16 w-16 opacity-[0.08]" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2">
            <Flag className="h-3.5 w-3.5 text-primary-400" />
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary-400">
              Track is clear
            </p>
          </div>
          <h2 className="font-display text-2xl font-black text-white">
            No one is racing right now.
          </h2>
          <p className="mt-1 text-sm text-dark-300">
            Book a slot to get your serial number on the grid.
          </p>
          <button
            type="button"
            onClick={() => navigate('/activities')}
            className="btn-primary mt-5 inline-flex items-center gap-2 text-sm"
          >
            Book a Slot
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-dark-800 via-dark-900 to-dark-950"
    >
      {/* Checkered flag corner accent */}
      <div className="checkered-pattern absolute -right-2 -top-2 h-20 w-20 opacity-[0.08]" />
      {/* Primary glow blob */}
      <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-500/5 blur-3xl" />

      <div className="relative p-5 lg:p-6">
        {/* Eyebrow */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-dark-300">
              Now Running
            </p>
          </div>
          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            Live
          </span>
        </div>

        {/* Active serial columns */}
        <div className="grid grid-cols-3 gap-3" aria-live="polite">
          {KART_TYPES.map((kart) => {
            const palette = KART_PALETTE[kart.gameSerialNumber]
            const slots =
              queueData.find((k) => k.gameSerialNumber === kart.gameSerialNumber)?.data?.slots ?? []
            // Prefer an explicit 'occupied' slot (actively racing); otherwise
            // fall back to the lowest-srno 'available' slot — the customer
            // who's next on the grid. Without this fallback the hero shows
            // "Idle" even when the queue card right below is showing 13
            // people waiting (occupied wasn't being set in this branch's
            // data shape, so the find() always returned undefined).
            const running =
              slots.find((s) => s.status === 'occupied') ??
              [...slots]
                .filter((s) => s.status === 'available')
                .sort((a, b) => a.srno - b.srno)[0] ??
              null

            return (
              <div key={kart.gameSerialNumber} className="flex flex-col items-center text-center">
                {running ? (
                  <span
                    className={`font-ticket ${palette.text} text-4xl font-bold leading-none tabular-nums drop-shadow-[0_2px_10px_rgba(0,102,255,0.2)] lg:text-6xl`}
                  >
                    #{pad(running.srno)}
                  </span>
                ) : (
                  <span className="font-ticket text-4xl font-bold leading-none text-dark-500 lg:text-6xl">
                    —
                  </span>
                )}
                <span className="mt-2 text-[11px] font-bold uppercase tracking-wider text-white">
                  {kart.name.replace(' kart', '')}
                </span>
                <span className={`text-[10px] ${running ? palette.text : 'text-dark-500'}`}>
                  {running ? kart.engineCc : 'Idle'}
                </span>
              </div>
            )
          })}
        </div>

        {/* Footer divider with stats */}
        <div className="mt-5 flex items-center gap-3 border-t border-white/5 pt-4 text-xs text-dark-300">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="font-semibold text-white">{totalWaiting}</span>
            <span>in queue</span>
          </span>
          {avgWaitMin !== null && (
            <>
              <span className="text-dark-500">·</span>
              <span>
                ~<span className="font-semibold text-white">{avgWaitMin} min</span> avg gap
              </span>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Kart Queue Card (compact) ────────────────────────────────────────

const MAX_VISIBLE_CELLS = 12

const KartQueueCell = ({ filled, color }: { filled: boolean; color: string }) => (
  <span
    className={`h-2 flex-1 rounded-sm transition-colors ${filled ? color : 'bg-white/[0.04]'}`}
  />
)

const KartQueueCard = ({
  kart,
  slots,
  loading,
}: {
  kart: (typeof KART_TYPES)[number]
  slots: WaitingSlot[]
  loading: boolean
}) => {
  const palette = KART_PALETTE[kart.gameSerialNumber]
  const counts = getSlotCounts(slots)
  const total = slots.length

  const waitingSlots = useMemo(
    () =>
      slots
        .filter((s) => s.status === 'available' || s.status === 'occupied')
        .sort((a, b) => a.srno - b.srno),
    [slots],
  )

  const lastDone = useMemo(() => {
    const done = slots.filter((s) => s.status === 'done')
    if (done.length === 0) return null
    return done.reduce((latest, s) => {
      if (!latest.completedAt) return s
      if (!s.completedAt) return latest
      return s.completedAt > latest.completedAt ? s : latest
    }, done[0])
  }, [slots])

  const firstWaiting = waitingSlots[0]
  const lastWaiting = waitingSlots[waitingSlots.length - 1]
  const visibleCount = Math.min(waitingSlots.length, MAX_VISIBLE_CELLS)
  const overflow = Math.max(0, waitingSlots.length - MAX_VISIBLE_CELLS)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-2xl border border-white/[0.06] bg-dark-900/80 backdrop-blur-sm"
    >
      {/* Accent bar */}
      <div className={`h-1 bg-gradient-to-r ${palette.gradient}`} />

      <div className="p-4 lg:p-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${palette.gradient} text-lg shadow-lg`}
              aria-hidden
            >
              {kart.icon}
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-display text-sm font-bold text-white">{kart.name}</h3>
              <span
                className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider ${palette.text} ${palette.chip} rounded-full px-1.5 py-0.5`}
              >
                {kart.engineCc}
              </span>
            </div>
          </div>

          {/* Waiting count pill (replaces the old Total + stats pills duplication) */}
          <div className="text-right">
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black tabular-nums text-white">
                {counts.available + counts.occupied}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-dark-400">in queue</span>
            </div>
            {total > 0 && (
              <div className="text-[10px] text-dark-500">
                {counts.done} done · {total} total
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        {loading && total === 0 ? (
          <div className="mt-4 flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-dark-500" />
          </div>
        ) : waitingSlots.length === 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
            <Flag className="h-3.5 w-3.5 text-dark-500" />
            <p className="text-xs text-dark-400">All clear — no active queue</p>
          </div>
        ) : (
          <>
            {/* Range label */}
            <div className="mt-4 flex items-center justify-between text-xs text-dark-300">
              <span className="font-mono tabular-nums">
                <span className="text-white">#{pad(firstWaiting.srno)}</span>
                {lastWaiting && lastWaiting.srno !== firstWaiting.srno && (
                  <>
                    <span className="mx-1 text-dark-500">→</span>
                    <span className="text-white">#{pad(lastWaiting.srno)}</span>
                  </>
                )}
              </span>
              {overflow > 0 && (
                <span className={`${palette.text} text-[10px] font-bold`}>+{overflow} more</span>
              )}
            </div>

            {/* Queue cell row */}
            <div className="mt-2 flex gap-1" aria-label={`${waitingSlots.length} slots waiting`}>
              {Array.from({ length: MAX_VISIBLE_CELLS }).map((_, i) => (
                <KartQueueCell key={i} filled={i < visibleCount} color={palette.cellFill} />
              ))}
            </div>
          </>
        )}

        {/* Last done footer */}
        {lastDone && (
          <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3 text-[11px] text-dark-400">
            <CheckCircle2 className="h-3 w-3 text-emerald-500/70" />
            <span className="font-mono tabular-nums text-dark-300">#{pad(lastDone.srno)}</span>
            {lastDone.completedAt && (
              <>
                <span className="text-dark-600">·</span>
                <span>{formatTimeAgo(lastDone.completedAt)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Recent Finishes strip ────────────────────────────────────────────

const RecentFinishes = ({ items }: { items: RecentFinish[] }) => {
  if (items.length === 0) return null
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Trophy className="h-3.5 w-3.5 text-emerald-500" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-dark-300">
          Recent finishes
        </h3>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {items.map((f, idx) => {
          const palette = KART_PALETTE[f.gameSerialNumber]
          return (
            <motion.div
              key={`${f.gameSerialNumber}-${f.srno}-${f.completedAt}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, delay: idx * 0.02 }}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5"
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full ${palette.chip} text-[9px] font-bold ${palette.text}`}
                aria-hidden
              >
                {palette.letter}
              </span>
              <span className="font-mono text-xs font-bold tabular-nums text-white">
                #{pad(f.srno)}
              </span>
              <span className="text-[10px] text-dark-400">{formatTimeAgo(f.completedAt)}</span>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Trophy icon (inline — avoids an extra lucide import since we only need one) ─

const Trophy = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
)

// ─── Skeleton loader (compact) ────────────────────────────────────────

const SkeletonCard = () => (
  <div className="overflow-hidden rounded-2xl border border-white/5 bg-dark-900">
    <div className="h-1 animate-pulse bg-gradient-to-r from-dark-700 to-dark-600" />
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-lg bg-dark-800" />
        <div className="space-y-1.5">
          <div className="h-3 w-20 animate-pulse rounded bg-dark-800" />
          <div className="h-2.5 w-10 animate-pulse rounded bg-dark-800" />
        </div>
      </div>
      <div className="h-2 w-full animate-pulse rounded bg-dark-800" />
      <div className="flex gap-1">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-2 flex-1 animate-pulse rounded-sm bg-dark-800" />
        ))}
      </div>
    </div>
  </div>
)

// ─── Main dashboard ───────────────────────────────────────────────────

export default function WaitingListDashboard() {
  const navigate = useNavigate()
  const { selectedLocation, locations } = useBooking()
  const [queueData, setQueueData] = useState<KartQueueData[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const branchId = selectedLocation
    ? resolveLocation(selectedLocation)?.branchId || selectedLocation
    : ''
  const currentLocation = locations.find((loc) => loc.id === selectedLocation)

  useEffect(() => {
    setLoading(true)
    setError(null)

    const unsubscribe = subscribeAllWaitingLists(
      branchId,
      (results) => {
        setQueueData(results)
        setLastUpdated(new Date())
        setLoading(false)
      },
      (err) => {
        setError(err.message || 'Failed to load waiting list.')
        setLoading(false)
      },
    )

    return () => unsubscribe()
  }, [branchId])

  // ── Derived data ──
  const allSlots = useMemo(() => queueData.flatMap((kd) => kd.data?.slots ?? []), [queueData])

  const totalWaiting = useMemo(
    () => allSlots.filter((s) => s.status === 'available' || s.status === 'occupied').length,
    [allSlots],
  )

  const avgWaitMin = useMemo(() => avgCompletionGapMinutes(allSlots), [allSlots])

  const recentFinishes = useMemo<RecentFinish[]>(() => {
    const items: RecentFinish[] = []
    for (const kd of queueData) {
      const kartName =
        KART_TYPES.find((k) => k.gameSerialNumber === kd.gameSerialNumber)?.name ?? ''
      for (const s of kd.data?.slots ?? []) {
        if (s.status === 'done' && s.completedAt) {
          items.push({
            srno: s.srno,
            gameSerialNumber: kd.gameSerialNumber,
            completedAt: s.completedAt,
            kartName,
          })
        }
      }
    }
    return items.sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 15)
  }, [queueData])

  const hasAnyData = allSlots.length > 0

  const pageTitle = useCallback(() => 'Waiting List', [])

  return (
    <div className="min-h-screen safe-bottom bg-dark-950 lg:mx-auto lg:max-w-6xl lg:px-8">
      <SEO
        title={pageTitle()}
        description="Live kart queue and waiting list status at A Square GoKarting."
        path="/waiting-list"
        noindex
      />

      {/* ── Sticky Header ── */}
      <div className="sticky top-0 z-50 bg-dark-950/90 backdrop-blur-2xl">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="font-display text-xl font-bold text-white">Waiting List</h1>
              <p className="text-sm font-medium text-dark-400">
                {currentLocation?.name || 'Select location'}
              </p>
            </div>
          </div>
          {lastUpdated && (
            <span className="text-[11px] tabular-nums text-dark-500">
              Updated {fmtTimeShortIST(lastUpdated)}
            </span>
          )}
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      {/* ── Content ── */}
      <div className="space-y-5 px-4 py-5">
        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </motion.div>
        )}

        {/* Now Running — hero (or empty state fallback inside component) */}
        <NowRunningHero
          queueData={queueData}
          avgWaitMin={avgWaitMin}
          totalWaiting={totalWaiting}
          hasData={hasAnyData}
        />

        {/* Kart queue grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={branchId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {loading && queueData.length === 0
              ? KART_TYPES.map((k) => <SkeletonCard key={k.gameSerialNumber} />)
              : KART_TYPES.map((kart) => {
                  const slots =
                    queueData.find((k) => k.gameSerialNumber === kart.gameSerialNumber)?.data
                      ?.slots ?? []
                  return (
                    <KartQueueCard
                      key={kart.gameSerialNumber}
                      kart={kart}
                      slots={slots}
                      loading={loading}
                    />
                  )
                })}
          </motion.div>
        </AnimatePresence>

        {/* Recent finishes — unified across karts */}
        {hasAnyData && <RecentFinishes items={recentFinishes} />}
      </div>
    </div>
  )
}
