import { useState } from 'react'
import { Ticket } from 'lucide-react'
import { RaiseTicketModal } from './RaiseTicketModal'

interface RaiseTicketButtonProps {
  variant: 'topbar' | 'sidebar'
}

export const RaiseTicketButton = ({ variant }: RaiseTicketButtonProps) => {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Raise Ticket"
        title="Raise Ticket"
        className={
          variant === 'sidebar'
            ? 'ui-btn ui-btn-primary w-full text-xs gap-2'
            : 'ui-btn ui-btn-primary text-xs gap-1.5 px-2.5 py-1.5 sm:px-3'
        }
      >
        <Ticket className="h-3.5 w-3.5" />
        {/* Sidebar always shows the label; topbar collapses to icon-only
            on mobile so the actions row fits without wrapping. */}
        <span className={variant === 'sidebar' ? '' : 'hidden sm:inline'}>Raise Ticket</span>
      </button>
      <RaiseTicketModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
