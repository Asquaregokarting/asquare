import { Star } from 'lucide-react'
import type { FeedbackRating } from '../../../../api/types'

interface Props {
  value: number // 0 means "not yet selected"
  onChange?: (rating: FeedbackRating) => void
  /** Read-only display mode (used in the locked detail view). */
  disabled?: boolean
  /** sm = compact (rows), md = default (form), lg = hero. */
  size?: 'sm' | 'md' | 'lg'
  /** ARIA label for the group. */
  label?: string
}

const SIZE_PX: Record<NonNullable<Props['size']>, number> = {
  sm: 14,
  md: 22,
  lg: 28,
}

const STARS: FeedbackRating[] = [1, 2, 3, 4, 5]

const StarRating = ({ value, onChange, disabled = false, size = 'md', label }: Props) => {
  const px = SIZE_PX[size]
  const isInteractive = !disabled && typeof onChange === 'function'

  return (
    <div
      className="flex items-center gap-1"
      role={isInteractive ? 'radiogroup' : undefined}
      aria-label={label ?? 'Rating'}
    >
      {STARS.map((star) => {
        const filled = star <= value
        const baseClass = filled ? 'text-warning' : 'text-muted/40'
        if (!isInteractive) {
          return (
            <Star
              key={star}
              size={px}
              className={baseClass}
              fill={filled ? 'currentColor' : 'none'}
              aria-hidden
            />
          )
        }
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(star)}
            className={`rounded transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 ${baseClass}`}
            aria-label={`${star} star${star === 1 ? '' : 's'}`}
            role="radio"
            aria-checked={star === value}
          >
            <Star size={px} fill={filled ? 'currentColor' : 'none'} />
          </button>
        )
      })}
    </div>
  )
}

export default StarRating
