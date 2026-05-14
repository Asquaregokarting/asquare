/**
 * CountUp — spring-animated number counter.
 *
 * Adapted from the React Bits source (https://reactbits.dev) with two
 * project-specific additions:
 *   1. TypeScript types
 *   2. `locale` prop (defaults to "en-IN" so revenue numbers render with
 *      Indian grouping — "1,24,390" not "1,243,90" — across both the
 *      animation frames and the static final value).
 *
 * To re-trigger the animation on every refresh, pass `key={to}` from the
 * call site. React will remount the component when the value changes,
 * resetting the spring back to `from`.
 */
import { useInView, useMotionValue, useSpring } from 'motion/react'
import { useCallback, useEffect, useRef } from 'react'

export interface CountUpProps {
  /** The target number to count up to. */
  to: number
  /** The initial number from which the count starts. Default: 0. */
  from?: number
  /** Direction of the count. When "down", from/to are reversed. Default: "up". */
  direction?: 'up' | 'down'
  /** Delay in seconds before the count starts. Default: 0. */
  delay?: number
  /** Duration of the count animation in seconds. Default: 2. */
  duration?: number
  /** Additional CSS class. */
  className?: string
  /** Gate the animation behind a boolean. Default: true. */
  startWhen?: boolean
  /** Thousands separator override. Default: "" (use locale grouping). */
  separator?: string
  /** Intl locale for number formatting. Default: "en-IN" (Indian grouping). */
  locale?: string
  /** Fires when the animation starts. */
  onStart?: () => void
  /** Fires when the animation ends. */
  onEnd?: () => void
}

export default function CountUp({
  to,
  from = 0,
  direction = 'up',
  delay = 0,
  duration = 2,
  className = '',
  startWhen = true,
  separator = '',
  locale = 'en-IN',
  onStart,
  onEnd,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const motionValue = useMotionValue(direction === 'down' ? to : from)

  // Spring tuning: tighter damping at shorter durations so the count
  // settles cleanly instead of overshooting.
  const damping = 20 + 40 * (1 / duration)
  const stiffness = 100 * (1 / duration)

  const springValue = useSpring(motionValue, { damping, stiffness })

  const isInView = useInView(ref, { once: true, margin: '0px' })

  const getDecimalPlaces = (num: number): number => {
    const str = num.toString()
    if (str.includes('.')) {
      const decimals = str.split('.')[1]
      if (parseInt(decimals, 10) !== 0) return decimals.length
    }
    return 0
  }

  const maxDecimals = Math.max(getDecimalPlaces(from), getDecimalPlaces(to))

  const formatValue = useCallback(
    (latest: number): string => {
      const hasDecimals = maxDecimals > 0
      const options: Intl.NumberFormatOptions = {
        useGrouping: !!separator || locale !== 'en-US',
        minimumFractionDigits: hasDecimals ? maxDecimals : 0,
        maximumFractionDigits: hasDecimals ? maxDecimals : 0,
      }
      const formatted = Intl.NumberFormat(locale, options).format(latest)
      // Only swap commas when the caller asked for a non-default separator.
      return separator ? formatted.replace(/,/g, separator) : formatted
    },
    [maxDecimals, separator, locale],
  )

  // Paint the initial value immediately so the user sees `from` (or `to`
  // for down-counts) on first render — before the spring kicks in.
  useEffect(() => {
    if (ref.current) {
      ref.current.textContent = formatValue(direction === 'down' ? to : from)
    }
  }, [from, to, direction, formatValue])

  useEffect(() => {
    if (isInView && startWhen) {
      if (typeof onStart === 'function') onStart()

      const startId = setTimeout(() => {
        motionValue.set(direction === 'down' ? from : to)
      }, delay * 1000)

      const endId = setTimeout(
        () => {
          if (typeof onEnd === 'function') onEnd()
        },
        delay * 1000 + duration * 1000,
      )

      return () => {
        clearTimeout(startId)
        clearTimeout(endId)
      }
    }
  }, [isInView, startWhen, motionValue, direction, from, to, delay, onStart, onEnd, duration])

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest: number) => {
      if (ref.current) {
        ref.current.textContent = formatValue(latest)
      }
    })
    return () => unsubscribe()
  }, [springValue, formatValue])

  return <span className={className} ref={ref} />
}
