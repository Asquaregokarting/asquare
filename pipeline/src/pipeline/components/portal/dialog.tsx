import * as React from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  // Hold the latest `onOpenChange` in a ref so the effect below depends only
  // on `open`. Otherwise every parent re-render with a fresh callback re-fires
  // the effect, bouncing `body.style.overflow` and re-binding the keydown
  // listener — wasteful and a focus-bug magnet.
  const onOpenChangeRef = React.useRef(onOpenChange)
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChangeRef.current(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <DialogContext.Provider value={{ onOpenChange }}>
          <motion.div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div
              className="absolute inset-0 bg-base/80 backdrop-blur-sm"
              onClick={() => onOpenChange(false)}
              aria-hidden
            />
            <motion.div
              className="relative z-10 w-full max-w-md mx-3 mb-3 sm:mb-0"
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            >
              {children}
            </motion.div>
          </motion.div>
        </DialogContext.Provider>
      )}
    </AnimatePresence>,
    document.body,
  )
}

const DialogContext = React.createContext<{ onOpenChange: (open: boolean) => void } | null>(null)

const DialogContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => {
  const ctx = React.useContext(DialogContext)
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'relative rounded-2xl border border-white/[0.08] bg-portal-surface p-6 shadow-2xl',
        className,
      )}
      {...props}
    >
      {children}
      {ctx && (
        <button
          type="button"
          onClick={() => ctx.onOpenChange(false)}
          className="absolute right-4 top-4 rounded-md p-1 text-portal-muted/60 hover:text-white transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}

const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('flex flex-col space-y-1.5 mb-4 text-left', className)} {...props} />
)

const DialogTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  children,
  ...props
}) => (
  <h2
    className={cn('text-lg font-black uppercase tracking-tight text-white', className)}
    {...props}
  >
    {children}
  </h2>
)

const DialogDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className,
  ...props
}) => <p className={cn('text-xs text-portal-muted', className)} {...props} />

const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6', className)}
    {...props}
  />
)

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
