import { NavLink } from 'react-router-dom'
import { Role, ThemeMode } from '../../api/types'
import { getActiveHighlightsForLabel } from '../../lib/feature-highlights'
import { NewBadge } from '../ui/NewBadge'
import { RaiseTicketButton } from '../tickets/RaiseTicketButton'

interface SidebarProps {
  role: Role
  userName: string
  navItems: Array<{ label: string; href: string }>
  themeMode: ThemeMode
  onCycleTheme: () => void
  onLogout: () => void
}

const themeModeLabel: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
}

export const Sidebar = ({
  role,
  userName,
  navItems,
  themeMode,
  onCycleTheme,
  onLogout,
}: SidebarProps) => (
  <aside className="hidden h-screen w-72 shrink-0 overflow-visible border-r border-border/55 bg-surface/92 p-4 lg:sticky lg:top-0 lg:flex lg:flex-col">
    <div className="shrink-0 border-b border-border/45 pb-4">
      <img
        src={`${import.meta.env.BASE_URL}${themeMode === 'light' ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
        alt="A Square GoKarting"
        className="mb-3 h-13 w-auto object-contain"
        draggable={false}
      />
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">Workspace Role</p>
      <h2 className="mt-2 font-display text-3xl leading-tight tracking-tight text-text">{role}</h2>
      <p className="mt-1 text-sm text-muted">{userName}</p>
      <p className="mt-2 text-sm text-muted">
        Navigate all operational modules from one control rail.
      </p>
    </div>

    <nav
      className="sidebar-scroll mt-5 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1"
      aria-label="Dashboard sections"
    >
      {navItems.map((item) => (
        <NavLink
          key={item.label}
          to={item.href}
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

    <div className="mt-4 hidden space-y-2 lg:block">
      <RaiseTicketButton variant="sidebar" />
      <button
        type="button"
        onClick={onCycleTheme}
        aria-label="Cycle theme mode"
        className="ui-btn ui-btn-neutral w-full text-xs"
      >
        Theme: {themeModeLabel[themeMode]}
      </button>
      <button
        type="button"
        onClick={onLogout}
        className="ui-btn ui-btn-danger w-full text-xs focus-visible:ring-critical/50"
      >
        Logout
      </button>
    </div>
  </aside>
)
