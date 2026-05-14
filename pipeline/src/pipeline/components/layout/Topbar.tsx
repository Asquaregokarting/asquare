import { useEffect, useRef, useState } from 'react'
import { Bell, LogOut, Megaphone, SunMoon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ThemeMode } from '../../api/types'
import { RaiseTicketButton } from '../tickets/RaiseTicketButton'
import { useTicketNotifications } from '../../features/tickets/use-ticket-notifications'
import { useAuth } from '../../features/auth/auth-context'
import {
  markGrievanceRead,
  subscribeMyGrievances,
  type GrievanceRecord,
} from '../../api/grievances-firestore'
import { logger } from '../../../lib/logger'

interface TopbarProps {
  themeMode: ThemeMode
  onCycleTheme: () => void
  onLogout: () => void
  onOpenMobileNav?: () => void
  showMobileNavToggle?: boolean
  mobileNavOpen?: boolean
  mobileNavDrawerId?: string
  /** When true, show the topbar on all screen sizes (not just mobile). */
  alwaysVisible?: boolean
}

const themeModeLabel: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
}

const NotificationsBell = () => {
  const { items, unreadCount, markRead } = useTicketNotifications()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const recent = items.slice(0, 10)

  const onItemClick = async (id: string, ticketId: string, alreadyRead: boolean) => {
    setOpen(false)
    if (!alreadyRead) {
      try {
        await markRead(id)
      } catch {
        /* swallow — opening still proceeds */
      }
    }
    navigate(`/tickets/${ticketId}`)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-expanded={open ? 'true' : 'false'}
        className="ui-btn ui-btn-neutral relative px-2 py-1.5 text-xs"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl-soft border border-border/70 bg-panel shadow-panel">
          <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted">
            Ticket notifications
          </div>
          {recent.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted">No notifications yet.</div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {recent.map((n) => (
                <li
                  key={n.id}
                  className={`border-b border-border/40 last:border-b-0 ${n.read ? '' : 'bg-primary/5'}`}
                >
                  <button
                    type="button"
                    onClick={() => onItemClick(n.id, n.ticketId, n.read)}
                    className="block w-full px-3 py-2 text-left hover:bg-surface/60"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-semibold">{n.ticketTitle}</span>
                      {!n.read ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-critical"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">{n.body}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

const GrievancesBell = () => {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<GrievanceRecord[]>([])
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!session) return
    const unsub = subscribeMyGrievances(
      { id: session.user.id, role: session.user.role },
      setItems,
      (err) => logger.error('topbar.grievances_subscribe_failed', err),
    )
    return () => unsub()
  }, [session])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (!session) return null
  const userId = session.user.id
  const unreadCount = items.filter((g) => !g.readBy[userId]).length
  const recent = items.slice(0, 10)

  const onItemClick = async (g: GrievanceRecord) => {
    setOpen(false)
    if (!g.readBy[userId]) {
      try {
        await markGrievanceRead(g.id, userId)
      } catch {
        /* swallow — opening still proceeds */
      }
    }
    navigate('/grievances')
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Messages (${unreadCount} unread)` : 'Messages'}
        className="ui-btn ui-btn-neutral relative px-2 py-1.5 text-xs"
      >
        <Megaphone className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-info px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl-soft border border-border/70 bg-panel shadow-panel">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs">
            <span className="font-semibold text-muted">Messages</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/grievances')
              }}
              className="text-[11px] text-info underline"
            >
              View all
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted">No messages yet.</div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {recent.map((g) => {
                const isUnread = !g.readBy[userId]
                return (
                  <li
                    key={g.id}
                    className={`border-b border-border/40 last:border-b-0 ${isUnread ? 'bg-info/5' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => void onItemClick(g)}
                      className="block w-full px-3 py-2 text-left hover:bg-surface/60"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-text">{g.title}</span>
                        {isUnread ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-info"
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted">{g.body}</div>
                      <div className="mt-0.5 text-[10px] text-muted">
                        From {g.sentBy.name} · {g.sentBy.role}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const Topbar = ({
  themeMode,
  onCycleTheme,
  onLogout,
  onOpenMobileNav,
  showMobileNavToggle = false,
  mobileNavOpen = false,
  mobileNavDrawerId,
  alwaysVisible = false,
}: TopbarProps) => {
  return (
    <header
      className={`relative isolate overflow-hidden rounded-2xl-soft bg-panel shadow-panel ${alwaysVisible ? 'px-5 py-4' : 'lg:hidden border border-border/70 px-4 py-3'}`}
    >
      {alwaysVisible ? (
        /* ── Cashier layout: logo top, hamburger below, actions top-right ── */
        <div className="relative flex items-center justify-between">
          <button
            type="button"
            onClick={onOpenMobileNav}
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls={mobileNavDrawerId}
            className="ui-btn ui-btn-neutral gap-2 px-3 py-2 text-xs"
          >
            <span className="inline-flex w-4 flex-col gap-[3px]" aria-hidden="true">
              <span className="h-0.5 w-full rounded bg-current" />
              <span className="h-0.5 w-full rounded bg-current" />
              <span className="h-0.5 w-full rounded bg-current" />
            </span>
            Menu
          </button>
          <img
            src={`${import.meta.env.BASE_URL}${themeMode === 'light' ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
            alt="A Square GoKarting"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-20 w-auto object-contain"
            draggable={false}
          />
          <div className="flex items-center gap-2">
            <NotificationsBell />
            <GrievancesBell />
            <RaiseTicketButton variant="topbar" />
            <button
              type="button"
              onClick={onCycleTheme}
              aria-label="Cycle theme mode"
              className="ui-btn ui-btn-neutral text-xs"
            >
              Theme: {themeModeLabel[themeMode]}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="ui-btn ui-btn-danger text-xs focus-visible:ring-critical/50"
            >
              Logout
            </button>
          </div>
        </div>
      ) : (
        /* ── Default mobile layout ──
         * Allow the action cluster to wrap to a second line on narrow
         * phones so nothing gets clipped behind the screen edge. Theme &
         * logout collapse to icon-only on mobile (label visible on sm+
         * so the affordance isn't lost on wider screens). */
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex shrink-0 items-center gap-2">
            {showMobileNavToggle ? (
              <button
                type="button"
                onClick={onOpenMobileNav}
                aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileNavOpen}
                aria-controls={mobileNavDrawerId}
                className="ui-btn ui-btn-neutral gap-2 px-3 text-xs"
              >
                <span className="inline-flex w-4 flex-col gap-1" aria-hidden="true">
                  <span className="h-0.5 w-full rounded bg-current" />
                  <span className="h-0.5 w-full rounded bg-current" />
                  <span className="h-0.5 w-full rounded bg-current" />
                </span>
                Menu
              </button>
            ) : (
              <span />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <NotificationsBell />
            <GrievancesBell />
            <RaiseTicketButton variant="topbar" />
            <button
              type="button"
              onClick={onCycleTheme}
              aria-label={`Theme: ${themeModeLabel[themeMode]}. Cycle theme mode.`}
              title={`Theme: ${themeModeLabel[themeMode]}`}
              className="ui-btn ui-btn-neutral gap-1.5 px-2.5 py-1.5 text-xs sm:px-3"
            >
              <SunMoon className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Theme: {themeModeLabel[themeMode]}</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Logout"
              className="ui-btn ui-btn-danger gap-1.5 px-2.5 py-1.5 text-xs focus-visible:ring-critical/50 sm:px-3"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
