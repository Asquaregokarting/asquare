import { ReactNode, useState } from 'react'
import { NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ModuleTab } from '../../api/types'
import { useAuth } from '../../features/auth/auth-context'
import { getRoleConfig, rolePathMap } from '../../features/dashboard/role-config'
import { getActiveHighlightsForLabel } from '../../lib/feature-highlights'
import { NewBadge } from '../ui/NewBadge'
import {
  getRoleMobileShortcuts,
  resolveRoleActionRoute,
} from '../../features/navigation/action-route-map'
import { canRoleAccessTab, getTabsForRole } from '../../features/navigation/module-manifest'
import { useTheme } from '../../features/theme/theme-context'
import { getLatestActiveShiftForUser } from '../../api/shifts-firestore'
import { AppShell } from './AppShell'

interface ModulePageLayoutProps {
  moduleTab: ModuleTab
  title: string
  subtitle: string
  breadcrumbs: string[]
  subnav?: Array<{ label: string; to: string }>
  subnavActions?: ReactNode
  children: ReactNode
  hideHeader?: boolean
}

export const ModulePageLayout = ({
  moduleTab,
  title,
  subtitle,
  breadcrumbs,
  subnav = [],
  subnavActions,
  children,
  hideHeader = false,
}: ModulePageLayoutProps) => {
  const { session, logout } = useAuth()
  const { mode, cycleMode } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const [showLogoutBlock, setShowLogoutBlock] = useState(false)

  if (!session) {
    return <Navigate replace to="/login" />
  }

  if (!canRoleAccessTab(session.user.role, moduleTab)) {
    return (
      <Navigate replace to={rolePathMap[session.user.role]} state={{ deniedModule: moduleTab }} />
    )
  }

  const roleConfig = getRoleConfig(session.user.role)
  const tabNav = getTabsForRole(session.user.role).map((tab) => ({
    label: tab.label,
    href: tab.path,
  }))
  const mobileShortcuts = getRoleMobileShortcuts(session.user.role)
  const quickFabHref = resolveRoleActionRoute(session.user.role, roleConfig.quickFabAction.id)

  return (
    <AppShell
      role={session.user.role}
      userName={session.user.name}
      navItems={tabNav}
      primaryActions={roleConfig.primaryActions}
      quickFabAction={roleConfig.quickFabAction}
      quickFabHref={quickFabHref}
      mobileShortcuts={mobileShortcuts}
      themeMode={mode}
      onCycleTheme={cycleMode}
      onLogout={async () => {
        if (session.user.role === 'Cashier') {
          try {
            const active = await getLatestActiveShiftForUser(session.user.id)
            if (active) {
              setShowLogoutBlock(true)
              return
            }
          } catch {
            /* allow logout if check fails */
          }
        }
        void logout()
      }}
    >
      <div className="ui-section-stack lg:space-y-5">
        {!hideHeader && (
          <div className="ui-toolbar">
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-center gap-1 text-xs text-muted"
            >
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className="inline-flex items-center gap-1">
                  {index > 0 ? <span>/</span> : null}
                  <span>{crumb}</span>
                </span>
              ))}
            </nav>
            <h2 className="mt-2 font-display text-2xl sm:text-3xl leading-none tracking-tight text-text lg:text-[2rem]">
              {title}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-muted">{subtitle}</p>
          </div>
        )}

        {!hideHeader && (subnav.length > 0 || subnavActions) ? (
          <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0">
            {subnav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `ui-btn min-h-9 px-3 py-1.5 text-xs whitespace-nowrap ${
                    isActive || location.pathname === item.to ? 'ui-btn-info' : 'ui-btn-neutral'
                  }`
                }
              >
                {item.label}
                {getActiveHighlightsForLabel(item.label).length > 0 && <NewBadge />}
              </NavLink>
            ))}
            {subnavActions}
          </div>
        ) : null}

        <div className={hideHeader ? '' : 'ui-section-stack lg:space-y-5'}>{children}</div>
      </div>

      {/* ── Cashier Logout Block Dialog ── */}
      {showLogoutBlock && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-border/70 bg-panel p-6 text-center shadow-2xl"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
              <svg
                className="h-7 w-7 text-warning"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="font-display text-lg font-bold text-text">Action Required</h3>
            <p className="mt-2 text-sm text-muted">Please complete Check Out before logging out.</p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowLogoutBlock(false)}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-muted transition-colors hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutBlock(false)
                  navigate('/billing/pos')
                }}
                className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
              >
                Go to Check Out
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
