import { memo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { StatusBadge } from './StatusBadge'

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'muted'

export interface ActionCardProps {
  label: string
  description: string
  hotkey?: string
  tone?: Tone
  to?: string
  onClick?: () => void
  disabled?: boolean
}

const ActionCardImpl = ({
  label,
  description,
  hotkey,
  tone = 'info',
  to,
  onClick,
  disabled = false,
}: ActionCardProps) => {
  const navigate = useNavigate()

  const handleClick = () => {
    if (disabled) return
    if (onClick) {
      onClick()
      return
    }
    if (to) {
      navigate(to)
    }
  }

  return (
    <motion.button
      type="button"
      whileHover={disabled ? {} : { y: -2, scale: 1.01 }}
      whileTap={disabled ? {} : { scale: 0.99 }}
      onClick={handleClick}
      disabled={disabled}
      className="group relative flex w-full flex-col gap-3 rounded-xl border border-border/45 bg-panel p-4 text-left shadow-sm transition-all duration-150 hover:border-info/35 hover:bg-info/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <StatusBadge tone={tone} className="ui-status-anchor" />
      <div className="pr-24">
        <h3 className="text-base font-semibold text-text">{label}</h3>
      </div>
      <p className="text-sm text-muted">{description}</p>
      {hotkey ? <p className="font-mono text-xs text-muted/80">Shortcut: {hotkey}</p> : null}
    </motion.button>
  )
}

// Memoized so dashboards that render many ActionCards don't re-run
// framer-motion initialization on unrelated parent updates.
export const ActionCard = memo(ActionCardImpl)
