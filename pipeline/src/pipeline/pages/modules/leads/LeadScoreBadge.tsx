import type { CSSProperties } from 'react'
import type { LeadScoreLabel } from '../../../api/types'

interface Props {
  // Both fields may be undefined on legacy leads (Superfone / RecentLogin
  // imports never stamped a score). The component must render something
  // sensible instead of throwing — accessing `.color` on an undefined
  // config trips the top-level ErrorBoundary and blanks the whole page.
  score: number | null | undefined
  label: LeadScoreLabel | null | undefined
  size?: 'sm' | 'md'
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// Continuous OKLCH heat ramp from 0 (cool blue) → 50 (amber) → 100 (red).
// The lightness peaks at warm so the number stays legible against the tinted
// pill background; chroma rises with heat to make hot leads visually louder.
const oklchPartsForScore = (score: number): { L: number; C: number; H: number } => {
  const clamped = Math.max(0, Math.min(100, score))
  if (clamped <= 50) {
    const t = clamped / 50
    return {
      L: lerp(0.62, 0.74, t),
      C: lerp(0.1, 0.16, t),
      H: lerp(240, 75, t),
    }
  }
  const t = (clamped - 50) / 50
  return {
    L: lerp(0.74, 0.6, t),
    C: lerp(0.16, 0.22, t),
    H: lerp(75, 25, t),
  }
}

const oklchString = (score: number, alpha = 1): string => {
  const { L, C, H } = oklchPartsForScore(score)
  return alpha < 1
    ? `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)} / ${alpha})`
    : `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`
}

const labelText = (score: number): string => {
  if (score >= 70) return 'Hot'
  if (score >= 40) return 'Warm'
  return 'Cold'
}

const LeadScoreBadge = ({ score, label, size = 'sm' }: Props) => {
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'
  const hasScore = typeof score === 'number' && Number.isFinite(score)

  if (!hasScore) {
    return (
      <span
        className={`ui-pill border-muted/30 bg-muted/15 text-muted ${sizeClass} inline-flex items-center gap-1`}
      >
        <span className="font-bold tabular-nums">—</span>
        <span>Unscored</span>
      </span>
    )
  }

  const numericScore = Math.round(score)
  const style: CSSProperties = {
    color: oklchString(numericScore),
    borderColor: oklchString(numericScore, 0.4),
    backgroundColor: oklchString(numericScore, 0.12),
  }

  // Use the supplied label if present (it's the source of truth in Firestore),
  // otherwise derive one from the number so the visual still reads "Hot/Warm/Cold".
  const text = label ? label.charAt(0).toUpperCase() + label.slice(1) : labelText(numericScore)

  return (
    <span
      className={`ui-pill border ${sizeClass} inline-flex items-center gap-1`}
      // OKLCH heat ramp is per-score; can't be expressed as a static Tailwind class.
      style={style}
      aria-label={`Lead score ${numericScore} (${text})`}
    >
      <span className="font-bold tabular-nums">{numericScore}</span>
      <span className="opacity-80">{text}</span>
    </span>
  )
}

export default LeadScoreBadge
