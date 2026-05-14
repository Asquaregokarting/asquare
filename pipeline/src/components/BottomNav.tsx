/* eslint-disable react-refresh/only-export-components -- co-located navItems const is fine; HMR is not the concern here */
import { useMemo, memo, lazy, Suspense, Component, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Gamepad2, Wallet, Ticket, Trophy, User, HelpCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { LucideIcon } from 'lucide-react'

// Lazy-load LiquidGlass so a WebGL failure doesn't crash the whole app
const LiquidGlass = lazy(() =>
  import('@specy/liquid-glass-react').then((m) => ({ default: m.LiquidGlass })),
)

/** Tiny error boundary: if LiquidGlass crashes, render children without the glass effect. */
class GlassFallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

export const navItems: NavItem[] = [
  {
    path: '/activities',
    label: 'Games',
    icon: Gamepad2,
  },
  {
    path: '/wallet',
    label: 'Wallet',
    icon: Wallet,
  },
  {
    path: '/bookings',
    label: 'Bookings',
    icon: Ticket,
  },
  {
    path: '/play',
    label: 'Play',
    icon: Trophy,
  },
  {
    path: '/help',
    label: 'Help',
    icon: HelpCircle,
  },
  {
    path: '/profile',
    label: 'Me',
    icon: User,
  },
]

function BottomNav() {
  const { user } = useAuth()
  const location = useLocation()

  // Dynamic nav items
  const displayNavItems = navItems.map((item) => {
    if (item.path === '/profile' && !user) {
      return { ...item, label: 'Login' }
    }
    return item
  })

  const glassStyle = useMemo(
    () => ({
      depth: 0.3,
      segments: 64,
      radius: 0.2, // Matches rounded-2xl (16px)
      roughness: 0.02,
      transmission: 0.95,
      reflectivity: 0.3,
      ior: 1.45,
      thickness: 0.8,
      dispersion: 0.05,
    }),
    [],
  )

  // Token: --primary-500 (see design-system/colors_and_type.css)
  const primaryColor = 'var(--primary-500)'

  const navContent = (
    <nav className="bg-dark-900/90 backdrop-blur-xl rounded-2xl p-[2px] h-[68px] flex items-center shadow-2xl overflow-hidden">
      <div className="flex justify-between items-center w-full gap-[2px] px-[2px] relative">
        {displayNavItems.map((item) => {
          const isActive =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname === item.path || location.pathname.startsWith(item.path + '/')

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className="relative flex items-center justify-center transition-all duration-300 outline-none"
            >
              <motion.div
                initial={false}
                animate={{
                  width: isActive ? '72px' : '44px',
                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0)',
                }}
                className={`flex flex-col items-center justify-center gap-[2px] h-[62px] px-[3px] rounded-xl overflow-hidden`}
              >
                <item.icon
                  size={20}
                  className={`shrink-0 transition-all duration-300 ${
                    isActive ? 'text-white' : 'text-white/40'
                  }`}
                  style={{
                    filter: isActive ? `drop-shadow(0 0 8px ${primaryColor})` : 'none',
                  }}
                />

                <AnimatePresence initial={false}>
                  {isActive && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.3 }}
                      className="text-[10px] font-bold text-white whitespace-nowrap tracking-tight"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50 w-[min(calc(100vw-32px),360px)] lg:hidden"
      style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))' }}
    >
      <GlassFallback fallback={navContent}>
        <Suspense fallback={navContent}>
          <LiquidGlass
            glassStyle={glassStyle}
            wrapperStyle={{ width: '100%', borderRadius: '1rem' }}
            style="width: 100%; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 1rem;"
          >
            {navContent}
          </LiquidGlass>
        </Suspense>
      </GlassFallback>
    </div>
  )
}

export default memo(BottomNav)
