import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { NavLink } from 'react-router-dom'
import { Role } from '../../api/types'
import { useTheme } from '../../features/theme/theme-context'
import { getActiveHighlightsForLabel } from '../../lib/feature-highlights'
import { NewBadge } from '../ui/NewBadge'

interface MobileNavDrawerProps {
  isOpen: boolean
  drawerId: string
  role: Role
  userName: string
  navItems: Array<{ label: string; href: string }>
  onClose: () => void
  /** When true, show the drawer on all screen sizes (not just mobile). */
  alwaysVisible?: boolean
}

const focusableSelector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export const MobileNavDrawer = ({
  isOpen,
  drawerId,
  role,
  userName,
  navItems,
  onClose,
  alwaysVisible = false,
}: MobileNavDrawerProps) => {
  const { mode } = useTheme()
  const reduceMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previousFocusedRef = useRef<HTMLElement | null>(null)

  // Hold onClose in a ref so the open-effect's cleanup (which restores focus
  // to `previousFocusedRef`) doesn't fire on every parent re-render. With
  // onClose in deps, an unstable callback would re-run cleanup mid-typing
  // and yank the caret back to the previously-focused element.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    previousFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const body = document.body
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    const panel = panelRef.current
    const focusables = panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? null
    focusables?.[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!panel) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const activeElements = panel.querySelectorAll<HTMLElement>(focusableSelector)
      if (activeElements.length === 0) {
        return
      }

      const first = activeElements[0]
      const last = activeElements[activeElements.length - 1]
      const current = document.activeElement as HTMLElement | null

      if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && current === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusedRef.current?.focus()
    }
  }, [isOpen])

  const overlayAnimation = reduceMotion
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }

  const panelAnimation = reduceMotion
    ? {}
    : {
        initial: { x: '-100%' },
        animate: { x: 0 },
        exit: { x: '-100%' },
        transition: { duration: 0.22, ease: 'easeOut' as const },
      }

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          {...overlayAnimation}
          className={`fixed inset-0 z-40 bg-base/70 backdrop-blur-sm ${alwaysVisible ? '' : 'lg:hidden'}`}
          onClick={onClose}
          aria-hidden="true"
        >
          <motion.div
            {...panelAnimation}
            id={drawerId}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            ref={panelRef}
            className="flex h-full w-[86vw] max-w-sm flex-col overflow-hidden border-r border-border/50 bg-surface/95 p-4 shadow-panel backdrop-blur"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
              <div>
                {!alwaysVisible && (
                  <img
                    src={`${import.meta.env.BASE_URL}${mode === 'light' ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
                    alt="A Square GoKarting"
                    className="mb-2 h-8 w-auto object-contain"
                    draggable={false}
                  />
                )}
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
                  Workspace Role
                </p>
                <h2 className="mt-1 font-display text-3xl leading-tight tracking-tight text-text">
                  {role}
                </h2>
                <p className="mt-1 text-sm text-muted">{userName}</p>
              </div>
              <button type="button" onClick={onClose} className="ui-btn ui-btn-neutral text-sm">
                Close
              </button>
            </div>

            <p className="mb-3 shrink-0 text-sm text-muted">
              Navigate all operational modules from one control rail.
            </p>

            <nav
              className="sidebar-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1"
              aria-label="Module navigation"
            >
              {navItems.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex min-h-10 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                      isActive
                        ? 'border-info/25 bg-info/15 text-info shadow-sm'
                        : 'border-transparent bg-transparent text-text hover:bg-panel/70 hover:text-info'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${isActive ? 'bg-accent' : 'bg-border'}`}
                      />
                      <span className="truncate">{item.label}</span>
                      {getActiveHighlightsForLabel(item.label).length > 0 && (
                        <NewBadge className="ml-auto shrink-0" />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
