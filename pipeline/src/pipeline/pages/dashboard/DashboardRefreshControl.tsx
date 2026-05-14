import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'

interface Props {
  title: ReactNode
  onRefresh: () => Promise<void> | void
  lastRefreshedAt: number // epoch ms
  isRefreshing: boolean
}

const STALE_THRESHOLD_SEC = 90 // after 90s the button starts glowing orange

const formatAge = (sec: number): string => {
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

// Audit-tool refresh control: live timestamp on the left, action button on the
// right. Three button states — idle / stale (animated electric border invites
// the click) / refreshing (spinner + brand-orange tint). On refetch a brief
// orange scanner line sweeps the viewport so the action feels consequential
// instead of swallowed.
const DashboardRefreshControl = ({ title, onRefresh, lastRefreshedAt, isRefreshing }: Props) => {
  const [now, setNow] = useState(() => Date.now())
  const [sweepKey, setSweepKey] = useState(0)
  const reducedMotion = useReducedMotion()

  // Tick the visible age once per second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Replay the sweep every time a refresh starts.
  useEffect(() => {
    if (isRefreshing) setSweepKey((k) => k + 1)
  }, [isRefreshing])

  const hasRefreshed = lastRefreshedAt > 0
  const ageSec = hasRefreshed ? Math.max(0, Math.floor((now - lastRefreshedAt) / 1000)) : 0
  const isStale = hasRefreshed && ageSec > STALE_THRESHOLD_SEC && !isRefreshing
  const ageLabel = formatAge(ageSec)

  const buttonClass = isRefreshing
    ? 'border-[#FF6B00]/55 bg-[#FF6B00]/10 text-[#FF6B00]'
    : isStale
      ? 'border-warning/55 bg-warning/10 text-warning shadow-sm hover:shadow-md'
      : 'border-border/60 bg-surface text-text shadow-sm hover:bg-surface/80 hover:shadow-md'

  const button = (
    <button
      type="button"
      onClick={() => void onRefresh()}
      disabled={isRefreshing}
      aria-busy={isRefreshing || undefined}
      aria-label={isStale ? 'Refresh dashboard (data is stale)' : 'Refresh dashboard'}
      className={`relative inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold tabular-nums transition active:scale-[0.97] disabled:cursor-wait ${buttonClass}`}
    >
      <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden />
      {isRefreshing ? 'Refreshing…' : isStale ? 'Refresh · Stale' : 'Refresh'}
    </button>
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title}
        <div className="flex items-center gap-3">
          <span
            className={`text-xs tabular-nums ${isStale ? 'text-warning' : 'text-muted'}`}
            aria-live="polite"
          >
            Refreshed <span className="font-semibold">{ageLabel}</span>
          </span>
          {button}
        </div>
      </div>

      {/* Scanner sweep — brand-orange line travels top-to-bottom while the
          refetch is in flight. prefers-reduced-motion replaces it with a
          single static flash that fades out. */}
      <AnimatePresence>
        {isRefreshing && (
          <motion.div
            key={sweepKey}
            aria-hidden
            className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[2px]"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,107,0,0) 5%, #FF6B00 50%, rgba(255,107,0,0) 95%, transparent 100%)',
              boxShadow: '0 0 24px rgba(255,107,0,0.55)',
            }}
            initial={reducedMotion ? { opacity: 0 } : { y: 0, opacity: 0 }}
            animate={
              reducedMotion ? { opacity: [0, 1, 0] } : { y: ['0vh', '95vh'], opacity: [0, 1, 1, 0] }
            }
            exit={{ opacity: 0 }}
            transition={{
              duration: reducedMotion ? 0.4 : 0.7,
              ease: [0.16, 1, 0.3, 1],
              times: reducedMotion ? undefined : [0, 0.15, 0.85, 1],
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

export default DashboardRefreshControl
