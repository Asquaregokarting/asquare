import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../components/layout/ModulePageLayout', () => ({
  ModulePageLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="module-layout" data-title={title}>
      {children}
    </div>
  ),
}))
vi.mock('../../features/auth/auth-context', () => ({
  useAuth: vi.fn(() => ({
    session: { user: { id: 'u1', name: 'Owner', role: 'Owner' }, token: 'fake' },
  })),
}))
vi.mock('../../api/auth', () => ({ authApi: { changePassword: vi.fn() } }))
vi.mock('../../api/asquare-gamification', () => ({
  asquareGamificationApi: { getConfig: vi.fn(() => Promise.resolve(null)), saveConfig: vi.fn() },
}))
vi.mock('../../api/device-sessions', () => ({
  deviceSessionsApi: { listSessions: vi.fn(() => Promise.resolve([])), revokeSession: vi.fn() },
  getStoredSessionId: vi.fn(() => 'current'),
}))
vi.mock('../../api/types', () => ({}))
vi.mock('../../api/user-profiles', () => ({
  userProfilesApi: { getProfile: vi.fn(() => Promise.resolve(null)), updateProfile: vi.fn() },
}))
vi.mock('../../api/vendor-registration', () => ({
  vendorRegistrationApi: { getRegistration: vi.fn(() => Promise.resolve(null)) },
}))
vi.mock('../../api/users', () => ({ usersApi: { getUser: vi.fn(() => Promise.resolve(null)) } }))
vi.mock('../../api/firestore-session', () => ({ isPrivilegedRole: vi.fn(() => true) }))
vi.mock('../../api/interakt-templates', () => ({ TEMPLATE_LIST: [] }))
vi.mock('../../features/navigation/module-manifest', () => ({ getTabsForRole: vi.fn(() => []) }))
vi.mock('../../features/theme/theme-context', () => ({
  useTheme: vi.fn(() => ({ theme: 'system', setTheme: vi.fn() })),
}))
vi.mock('../../features/preferences/user-preferences', () => ({
  createDefaultUserPreferences: vi.fn(() => ({})),
  loadUserPreferences: vi.fn(() => Promise.resolve({})),
  saveUserPreferences: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('../../components/ui/DetailPanel', () => ({
  DetailPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/ui/SummaryCards', () => ({ SummaryCards: () => null }))
vi.mock('../../../lib/date-format', () => ({
  fmtDateTimeFullIST: vi.fn(() => ''),
  fmtDateIST: vi.fn(() => ''),
}))
vi.mock('../../../lib/locations', () => ({
  getLocationShortName: vi.fn((s: string) => s),
  getAllLocations: vi.fn(() => []),
}))
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import SettingsModule from './SettingsModule'

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('SettingsModule', () => {
  it('renders profile view', () => {
    wrap(<SettingsModule />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders password view', () => {
    wrap(<SettingsModule view="password" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders preferences view', () => {
    wrap(<SettingsModule view="preferences" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders devices view', () => {
    wrap(<SettingsModule view="devices" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
  it('renders gamification view', () => {
    wrap(<SettingsModule view="gamification" />)
    expect(screen.getByTestId('module-layout')).toBeInTheDocument()
  })
})
