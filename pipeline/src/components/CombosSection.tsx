import { useEffect, useMemo, useState, useRef } from 'react'
import { motion, useInView, useReducedMotion, type Variants, AnimatePresence } from 'framer-motion'
import {
  Bike,
  Car,
  CircleDot,
  Coffee,
  Cake,
  Camera,
  Flag,
  Gamepad2,
  Gift,
  Plane,
  Sparkles,
  Ticket,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { listActiveCombosForLocation, type ComboSummary } from '../services/comboService'
import { formatCurrency } from '../lib/utils'

interface CombosSectionProps {
  locationKey: string | undefined
}

/**
 * A small dictionary of keyword → icon. We probe the item name in priority
 * order; first match wins. The fallback is `Sparkles` so every combo card
 * always has a meaningful glyph row, even for unmapped items.
 */
const ICON_DICTIONARY: Array<{ test: RegExp; icon: LucideIcon }> = [
  { test: /heli|chopper|fly/i, icon: Plane },
  { test: /kart|race|track|grand prix|gp/i, icon: Car },
  { test: /bike|cycle|moto/i, icon: Bike },
  { test: /bowl|pin/i, icon: CircleDot },
  { test: /game|arcade|vr/i, icon: Gamepad2 },
  { test: /drone/i, icon: Plane },
  { test: /photo|polaroid|memory/i, icon: Camera },
  { test: /cake|birthday|party/i, icon: Cake },
  { test: /food|drink|cafe|snack/i, icon: Coffee },
  { test: /trophy|champion|prize/i, icon: Trophy },
  { test: /gift|voucher|hamper/i, icon: Gift },
  { test: /ticket|pass|entry/i, icon: Ticket },
  { test: /flag|finish/i, icon: Flag },
  { test: /boost|fast|speed/i, icon: Zap },
]

const iconFor = (itemName: string): LucideIcon => {
  const found = ICON_DICTIONARY.find(({ test }) => test.test(itemName))
  return found?.icon ?? Sparkles
}

const HEADLINE = 'Combos'

const easeOutQuart = [0.25, 1, 0.5, 1] as const

export const CombosSection = ({ locationKey }: CombosSectionProps) => {
  const [combos, setCombos] = useState<ComboSummary[]>([])
  const [loading, setLoading] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const inView = useInView(sectionRef, { once: true, amount: 0.25 })
  const reduceMotion = useReducedMotion() ?? false

  useEffect(() => {
    if (!locationKey) {
      setCombos([])
      return
    }
    let cancelled = false
    setLoading(true)
    listActiveCombosForLocation(locationKey)
      .then((rows) => {
        if (!cancelled) setCombos(rows)
      })
      .catch(() => {
        if (!cancelled) setCombos([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [locationKey])

  const maxSavings = useMemo(
    () => combos.reduce((max, c) => Math.max(max, c.savingsPercent), 0),
    [combos],
  )

  // Hide entirely while loading or when there's nothing to show — combos are
  // marketing, not navigation, so silence is the right empty state.
  if (loading || combos.length === 0) return null

  return (
    <section ref={sectionRef} aria-label="Combo bundles" className="relative mb-3 lg:mb-6">
      <ComboHeader inView={inView} reduceMotion={reduceMotion} maxSavings={maxSavings} />
      <ComboCardRail combos={combos} inView={inView} reduceMotion={reduceMotion} />
    </section>
  )
}

interface HeaderProps {
  inView: boolean
  reduceMotion: boolean
  maxSavings: number
}

const ComboHeader = ({ inView, reduceMotion, maxSavings }: HeaderProps) => {
  const letters = HEADLINE.split('')

  // Reduced motion: solid drop-in of the whole headline, no per-letter dance.
  const headingVariants: Variants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.2 } },
      }
    : {
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.04, delayChildren: 0.05 },
        },
      }

  const letterVariants: Variants = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { y: 28, opacity: 0, filter: 'blur(8px)' },
        visible: {
          y: 0,
          opacity: 1,
          filter: 'blur(0px)',
          transition: { duration: 0.55, ease: easeOutQuart },
        },
      }

  const sublineVariants: Variants = {
    hidden: { y: 12, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.5, delay: reduceMotion ? 0 : 0.32, ease: easeOutQuart },
    },
  }

  return (
    <header className="mb-3.5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <motion.p
          className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary md:text-[11px]"
          initial={{ opacity: 0, y: -6 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.4, ease: easeOutQuart }}
        >
          <Sparkles className="h-3 w-3" aria-hidden />
          Better together
        </motion.p>
        <motion.h2
          aria-label={HEADLINE}
          className="font-display text-2xl font-extrabold leading-[1.05] text-white md:text-3xl lg:text-[2.1rem]"
          variants={headingVariants}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
        >
          {/* aria-hidden on the per-letter spans; the parent h2 carries the
              accessible name via aria-label so screen readers don't read
              "C o m b o s" letter by letter. */}
          {letters.map((char, idx) => (
            <motion.span
              key={`${char}-${idx}`}
              variants={letterVariants}
              className="inline-block"
              aria-hidden
            >
              {char}
            </motion.span>
          ))}
        </motion.h2>
        <motion.p
          className="mt-1.5 text-xs text-dark-300 md:text-sm"
          variants={sublineVariants}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
        >
          {maxSavings > 0
            ? `Curated bundles. Save up to ${maxSavings}% versus booking each activity alone.`
            : 'Curated bundles. Book a story, not a single ride.'}
        </motion.p>
      </div>
    </header>
  )
}

interface RailProps {
  combos: ComboSummary[]
  inView: boolean
  reduceMotion: boolean
}

const ComboCardRail = ({ combos, inView, reduceMotion }: RailProps) => {
  const railVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: reduceMotion ? 0 : 0.085,
        delayChildren: reduceMotion ? 0 : 0.45,
      },
    },
  }

  // Layout adapts to combo count: 1 = wide feature, 2 = two-up, 3+ = scroll
  // rail on mobile / 3-up grid on desktop. Avoids the identical-card grid
  // anti-pattern when there's only one combo.
  const layoutClass = useMemo(() => {
    if (combos.length === 1) return 'grid grid-cols-1'
    if (combos.length === 2) return 'grid grid-cols-1 md:grid-cols-2'
    return [
      'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2',
      'lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:pb-0',
      '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
    ].join(' ')
  }, [combos.length])

  return (
    <motion.div
      className={layoutClass}
      variants={railVariants}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
    >
      {combos.map((combo, idx) => (
        <ComboCard
          key={combo.id}
          combo={combo}
          variant={combos.length === 1 ? 'feature' : 'standard'}
          isMostSavings={idx === 0 && combo.savingsPercent > 0}
          reduceMotion={reduceMotion}
          inView={inView}
        />
      ))}
    </motion.div>
  )
}

interface ComboCardProps {
  combo: ComboSummary
  variant: 'feature' | 'standard'
  isMostSavings: boolean
  reduceMotion: boolean
  inView: boolean
}

const ComboCard = ({ combo, variant, isMostSavings, reduceMotion, inView }: ComboCardProps) => {
  const [hovered, setHovered] = useState(false)
  const cardVariants: Variants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.2 } },
      }
    : {
        hidden: { y: 28, opacity: 0 },
        visible: {
          y: 0,
          opacity: 1,
          transition: { duration: 0.55, ease: easeOutQuart },
        },
      }

  const isFeature = variant === 'feature'
  const trimmedItems = combo.items.slice(0, 4)
  const overflowCount = Math.max(0, combo.items.length - trimmedItems.length)

  return (
    <motion.article
      variants={cardVariants}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      whileHover={reduceMotion ? undefined : { y: -4 }}
      transition={{ duration: 0.3, ease: easeOutQuart }}
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-secondary/25 bg-dark-800/90 shadow-[0_8px_24px_-12px_rgba(255,107,0,0.35)] ${
        isFeature ? 'min-h-[300px] md:min-h-[340px]' : 'min-w-[260px] snap-start lg:min-w-0'
      }`}
    >
      {/* Decorative speed glow — single soft radial in the corner. Not a
          glassmorphism scrim, not a gradient text effect. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-8 -right-8 h-32 w-32 rounded-full bg-secondary/20 blur-2xl"
      />

      <div className="relative flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3
            className={`font-display font-extrabold leading-[1.1] text-white ${
              isFeature ? 'text-xl md:text-2xl' : 'text-lg'
            }`}
          >
            {combo.name}
          </h3>
          {combo.savingsPercent > 0 ? (
            <SavingsBadge percent={combo.savingsPercent} pulse={isMostSavings && !reduceMotion} />
          ) : null}
        </div>

        <ComboItemRow
          items={trimmedItems}
          overflowCount={overflowCount}
          hovered={hovered}
          reduceMotion={reduceMotion}
        />

        <ComboPriceBlock
          comboPrice={combo.comboPrice}
          originalTotal={combo.originalTotal}
          savingsAmount={combo.savingsAmount}
          inView={inView}
          reduceMotion={reduceMotion}
        />

        <button
          type="button"
          className="group/cta mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-bold text-dark-900 transition-[transform,filter] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-800"
          // Add-to-cart wiring is intentionally out of scope for the design
          // pass; this CTA scrolls to the activities grid as a sensible
          // placeholder so the visual flow stays demoable.
          onClick={() => {
            const grid = document.getElementById('activities-grid')
            grid?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          Choose this combo
          <span
            aria-hidden
            className="inline-block transition-transform duration-300 group-hover/cta:translate-x-1"
          >
            →
          </span>
        </button>
      </div>
    </motion.article>
  )
}

const SavingsBadge = ({ percent, pulse }: { percent: number; pulse: boolean }) => (
  <motion.span
    aria-label={`Save ${percent} percent`}
    className="relative inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-dark-900"
  >
    Save {percent}%
    {pulse ? (
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full border-2 border-secondary"
        initial={{ scale: 1, opacity: 0.6 }}
        animate={{ scale: 1.55, opacity: 0 }}
        transition={{
          duration: 1.6,
          ease: easeOutQuart,
          repeat: Infinity,
          repeatDelay: 1.4,
        }}
      />
    ) : null}
  </motion.span>
)

interface ItemRowProps {
  items: ComboSummary['items']
  overflowCount: number
  hovered: boolean
  reduceMotion: boolean
}

const ComboItemRow = ({ items, overflowCount, hovered, reduceMotion }: ItemRowProps) => {
  return (
    <ul className="-mx-1 flex flex-wrap items-stretch gap-y-2.5">
      {items.map((item, idx) => {
        const Icon = iconFor(item.itemName)
        return (
          <li key={`${item.activityId}-${idx}`} className="contents">
            <ComboItemPill
              icon={Icon}
              label={item.itemName}
              hovered={hovered}
              reduceMotion={reduceMotion}
              orbitIndex={idx}
            />
            {idx < items.length - 1 || overflowCount > 0 ? (
              <span aria-hidden className="mx-1 self-center text-secondary/60">
                +
              </span>
            ) : null}
          </li>
        )
      })}
      {overflowCount > 0 ? (
        <li className="contents">
          <span className="self-center rounded-full border border-dashed border-secondary/40 px-2 py-1 text-[10px] font-bold text-secondary">
            +{overflowCount} more
          </span>
        </li>
      ) : null}
    </ul>
  )
}

interface ItemPillProps {
  icon: LucideIcon
  label: string
  hovered: boolean
  reduceMotion: boolean
  orbitIndex: number
}

const ComboItemPill = ({ icon: Icon, label, hovered, reduceMotion, orbitIndex }: ItemPillProps) => {
  // Each pill picks a tiny phase offset so a row of 3-4 pills doesn't pulse
  // in lockstep — staggered breathing reads more alive. Hover accelerates.
  const idleAnim = reduceMotion
    ? {}
    : {
        scale: [1, 1.05, 1],
        transition: {
          duration: 4,
          ease: 'easeInOut',
          repeat: Infinity,
          delay: orbitIndex * 0.3,
        } as const,
      }
  const hoverAnim = reduceMotion
    ? {}
    : {
        scale: 1.12,
        rotate: orbitIndex % 2 === 0 ? 6 : -6,
        transition: { duration: 0.35, ease: easeOutQuart },
      }

  return (
    <span className="mx-1 inline-flex items-center gap-1.5 rounded-full border border-secondary/30 bg-dark-900/60 px-2.5 py-1 text-[11px] text-white">
      <motion.span
        aria-hidden
        animate={hovered ? hoverAnim : idleAnim}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary/20 text-secondary"
      >
        <Icon className="h-3 w-3" />
      </motion.span>
      <span className="max-w-[110px] truncate">{label}</span>
    </span>
  )
}

interface PriceBlockProps {
  comboPrice: number
  originalTotal: number
  savingsAmount: number
  inView: boolean
  reduceMotion: boolean
}

const ComboPriceBlock = ({
  comboPrice,
  originalTotal,
  savingsAmount,
  inView,
  reduceMotion,
}: PriceBlockProps) => {
  const animatedPrice = useCountUp({
    target: comboPrice,
    start: originalTotal,
    duration: 900,
    enabled: inView && !reduceMotion,
  })

  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        {originalTotal > comboPrice ? (
          <p className="text-[11px] text-dark-400 line-through">{formatCurrency(originalTotal)}</p>
        ) : null}
        <p className="font-display text-[1.7rem] font-extrabold leading-none text-white">
          {formatCurrency(reduceMotion ? comboPrice : animatedPrice)}
        </p>
      </div>
      {savingsAmount > 0 ? (
        <AnimatePresence>
          <motion.span
            className="rounded-md bg-secondary/15 px-2 py-1 text-[11px] font-bold text-secondary"
            initial={{ opacity: 0, x: 8 }}
            animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: 8 }}
            transition={{ delay: 0.6, duration: 0.4, ease: easeOutQuart }}
          >
            you save {formatCurrency(savingsAmount)}
          </motion.span>
        </AnimatePresence>
      ) : null}
    </div>
  )
}

/**
 * Lightweight count-up that lerps from `start` to `target` over `duration`
 * using ease-out-quart. Skips when `enabled` is false (reduced motion or
 * not yet in view).
 */
function useCountUp({
  target,
  start,
  duration,
  enabled,
}: {
  target: number
  start: number
  duration: number
  enabled: boolean
}): number {
  const [value, setValue] = useState(enabled ? start : target)

  useEffect(() => {
    if (!enabled) {
      setValue(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const delta = target - start
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      // ease-out-quart
      const eased = 1 - Math.pow(1 - t, 4)
      setValue(start + delta * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, start, duration, enabled])

  return Math.round(value)
}

export default CombosSection
