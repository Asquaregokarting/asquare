// A² Scanner — ScanResultCard (status badge for serial items)

import { motion } from 'framer-motion'
import { ScanSerialItem } from '../types/scanner.types'

interface ScanResultCardProps {
  item: ScanSerialItem
  selected: boolean
  onToggle: () => void
  disabled?: boolean
}

const currency = (amount: number) => `INR ${Math.round(amount).toLocaleString('en-IN')}`

export const ScanResultCard = ({ item, selected, onToggle, disabled }: ScanResultCardProps) => {
  const isValid = item.status === 'valid'

  return (
    <motion.button
      type="button"
      onClick={isValid && !disabled ? onToggle : undefined}
      disabled={!isValid || disabled}
      layout
      whileTap={isValid ? { scale: 0.97 } : {}}
      className={`
        relative w-full rounded-xl border p-4 text-left transition-all
        ${!isValid ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        ${
          selected
            ? 'border-signal-green-bright/60 bg-signal-green-bright/10'
            : isValid
              ? 'border-gray-200 bg-gray-50 hover:border-track-accent/40 hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
              : 'border-signal-red-hot/20 bg-signal-red-hot/5'
        }
      `}
    >
      {/* Selection indicator */}
      {isValid && (
        <span
          className={`absolute right-4 top-4 flex size-5 items-center justify-center rounded-full border-2 transition-all ${
            selected
              ? 'border-signal-green-bright bg-signal-green-bright'
              : 'border-gray-300 dark:border-white/30'
          }`}
        >
          {selected && (
            <svg className="size-3 text-white" viewBox="0 0 12 12" fill="none">
              <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </span>
      )}

      {/* Content */}
      <div className="pr-8">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              isValid
                ? 'bg-signal-green-bright/20 text-signal-green-bright'
                : 'bg-signal-red-hot/20 text-signal-red-hot'
            }`}
          >
            {isValid ? '\u2713 Valid' : '\u2715 Used'}
          </span>
          <span className="text-xs text-gray-400 dark:text-white/40">{item.serialId}</span>
        </div>
        <p className="mt-1.5 font-medium text-gray-900 dark:text-white">{item.itemName}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-white/50">{currency(item.unitPrice)}</p>
        {item.usedBy ? (
          <p className="mt-1 text-xs text-signal-red-hot/60">Used by {item.usedBy}</p>
        ) : null}
      </div>
    </motion.button>
  )
}
