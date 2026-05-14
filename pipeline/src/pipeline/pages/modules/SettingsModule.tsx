import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { fmtDateTimeFullIST, fmtDateIST } from '../../../lib/date-format'
import { authApi } from '../../api/auth'
import { GamificationConfig, asquareGamificationApi } from '../../api/asquare-gamification'

import { deviceSessionsApi, getStoredSessionId } from '../../api/device-sessions'
import {
  DeviceSessionRecord,
  Role,
  ThemeMode,
  UserGender,
  UserNotificationSettings,
  UserProfileBundle,
  UserRecord,
  VendorRegistrationRecord,
} from '../../api/types'
import { userProfilesApi } from '../../api/user-profiles'
import { vendorRegistrationApi } from '../../api/vendor-registration'
import { usersApi } from '../../api/users'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { SummaryCards } from '../../components/ui/SummaryCards'
import { getLocationShortName, getAllLocations } from '../../../lib/locations'
import { isPrivilegedRole } from '../../api/firestore-session'
import { useAuth } from '../../features/auth/auth-context'
import { getTabsForRole } from '../../features/navigation/module-manifest'
import {
  createDefaultUserPreferences,
  loadUserPreferences,
  saveUserPreferences,
  type NotificationSound,
  type UserPreferenceState,
} from '../../features/preferences/user-preferences'
import { useTheme } from '../../features/theme/theme-context'
import { TEMPLATE_LIST } from '../../api/interakt-templates'
import {
  bookingConfirmationConfigApi,
  type BookingConfirmationConfig,
} from '../../api/booking-confirmation-config'
import { TicketCategoriesSettings } from './settings/TicketCategoriesSettings'
import { TicketKbSettings } from './settings/TicketKbSettings'
import { TicketCannedSettings } from './settings/TicketCannedSettings'

export type SettingsView =
  | 'profile'
  | 'password'
  | 'preferences'
  | 'gamification'
  | 'devices'
  | 'template-images'
  | 'tickets-categories'
  | 'tickets-kb'
  | 'tickets-canned'

const subnav = [
  { label: 'Profile', to: '/settings/profile' },
  { label: 'Password', to: '/settings/password' },
  { label: 'Preferences', to: '/settings/preferences' },
  { label: 'Devices', to: '/settings/devices' },
  { label: 'Gamification', to: '/settings/gamification' },
  { label: 'Template Images', to: '/settings/template-images' },
  { label: 'Ticket categories', to: '/settings/tickets/categories' },
  { label: 'Ticket KB', to: '/settings/tickets/kb' },
  { label: 'Canned responses', to: '/settings/tickets/canned' },
]

const titleMap: Record<SettingsView, string> = {
  profile: 'Profile Settings',
  password: 'Password Security',
  preferences: 'Display Preferences',
  devices: 'Logged In Devices',
  gamification: 'Gamification',
  'template-images': 'Template Images',
  'tickets-categories': 'Ticket Categories',
  'tickets-kb': 'Ticket Knowledge Base',
  'tickets-canned': 'Ticket Canned Responses',
}

const subtitleMap: Record<SettingsView, string> = {
  profile: 'Account identity and workspace visibility details.',
  password: 'Rotate credentials and enforce secure access habits.',
  preferences: 'Theme, navigation defaults, and local notification behavior.',
  devices: 'View and manage active sessions across all your devices.',
  gamification: 'Gamification rules, rewards, and engagement settings.',
  'template-images': 'Upload header images for Interakt WhatsApp notification templates.',
  'tickets-categories':
    'Manage ticket categories: priority floor, SLAs, and routing chains. Owner/Admin only.',
  'tickets-kb':
    'Knowledge-base articles surfaced in the ticket "/" menu and the customer Help page.',
  'tickets-canned': 'Reusable canned replies for the ticket comment composer. Owner/Admin only.',
}

const supportsBrowserNotifications = typeof window !== 'undefined' && 'Notification' in window
const MAX_CUSTOM_SOUND_BYTES = 300 * 1024
const MAX_PROFILE_PHOTO_BYTES = 350 * 1024

interface ProfileFormState {
  name: string
  email: string
  phone: string
  profilePhotoUrl: string
  dob: string
  gender: '' | UserGender
  branchId: string
  aadharNumber: string
  panNumber: string
  bankAccountNumber: string
  bankName: string
  ifscCode: string
}

const createEmptyProfileForm = (): ProfileFormState => ({
  name: '',
  email: '',
  phone: '',
  profilePhotoUrl: '',
  dob: '',
  gender: '',
  branchId: '',
  aadharNumber: '',
  panNumber: '',
  bankAccountNumber: '',
  bankName: '',
  ifscCode: '',
})

const toProfileForm = (bundle: UserProfileBundle): ProfileFormState => ({
  name: bundle.account.name ?? '',
  email: bundle.account.email ?? '',
  phone: bundle.account.phone ?? '',
  profilePhotoUrl: bundle.profile.profilePhotoUrl ?? '',
  dob: bundle.profile.dob ?? '',
  gender: bundle.profile.gender ?? '',
  branchId: bundle.profile.branchId ?? '',
  aadharNumber: bundle.sensitive.aadharNumber ?? '',
  panNumber: bundle.sensitive.panNumber ?? '',
  bankAccountNumber: bundle.sensitive.bankAccountNumber ?? '',
  bankName: bundle.sensitive.bankName ?? '',
  ifscCode: bundle.sensitive.ifscCode ?? '',
})

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (!result) {
        reject(new Error('Failed to read file.'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })

const SettingsModule = ({ view }: { view: SettingsView }) => {
  const { session, updateSessionUser } = useAuth()
  const { mode, setMode } = useTheme()
  const [loading, setLoading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(mode)
  const [preferences, setPreferences] = useState<UserPreferenceState>(
    createDefaultUserPreferences('/dashboard'),
  )
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>(
    supportsBrowserNotifications ? Notification.permission : 'denied',
  )
  const [profileBundle, setProfileBundle] = useState<UserProfileBundle | null>(null)
  const [profileForm, setProfileForm] = useState<ProfileFormState>(createEmptyProfileForm())
  const [vendorRegistration, setVendorRegistration] = useState<VendorRegistrationRecord | null>(
    null,
  )

  // Gamification state
  const [gamConfig, setGamConfig] = useState<GamificationConfig | null>(null)
  const [gamLoading, setGamLoading] = useState(false)
  const [gamSaving, setGamSaving] = useState(false)

  // Booking-confirmation default Interakt template (singleton config doc).
  // Loaded once when the Template Images view is rendered.
  const [bookingConfirmConfig, setBookingConfirmConfig] =
    useState<BookingConfirmationConfig | null>(null)
  const [bookingConfirmDraft, setBookingConfirmDraft] = useState<{
    defaultTemplateId: string
    defaultTemplateLanguage: string
  }>({ defaultTemplateId: '', defaultTemplateLanguage: '' })
  const [bookingConfirmLoading, setBookingConfirmLoading] = useState(false)
  const [bookingConfirmSaving, setBookingConfirmSaving] = useState(false)
  const [bookingConfirmError, setBookingConfirmError] = useState<string | null>(null)

  // Interakt test state
  // Template images state (upload-only, no Firestore)
  // Devices state
  const [devices, setDevices] = useState<DeviceSessionRecord[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false)
  const currentSessionId = getStoredSessionId()

  // Admin device management state
  const isAdminUser = session ? isPrivilegedRole(session.user.role) : false
  const [adminAllSessions, setAdminAllSessions] = useState<DeviceSessionRecord[]>([])
  const [adminUsers, setAdminUsers] = useState<UserRecord[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminSelectedUserId, setAdminSelectedUserId] = useState<string | null>(null)
  const [adminSelectedSessions, setAdminSelectedSessions] = useState<DeviceSessionRecord[]>([])
  const [adminSelectedLoading, setAdminSelectedLoading] = useState(false)
  const [adminRoleFilter, setAdminRoleFilter] = useState<Role | ''>('')
  const [adminSearchQuery, setAdminSearchQuery] = useState('')
  const [adminConfirmRevokeId, setAdminConfirmRevokeId] = useState<string | null>(null)
  const [adminConfirmRevokeAllUser, setAdminConfirmRevokeAllUser] = useState<string | null>(null)
  const [adminRevokingId, setAdminRevokingId] = useState<string | null>(null)
  const [adminRevokingAll, setAdminRevokingAll] = useState(false)

  const availableTabs = useMemo(() => {
    if (!session) {
      return []
    }
    return getTabsForRole(session.user.role)
  }, [session])

  useEffect(() => {
    if (!session) {
      return
    }
    const defaultTabPath = availableTabs[0]?.path ?? '/dashboard'
    const stored = loadUserPreferences(session.user.id, defaultTabPath)
    setPreferences({
      ...stored,
      notifications: session.user.notificationSettings ?? stored.notifications,
    })
    setCurrentTheme(mode)
  }, [session, availableTabs, mode])

  useEffect(() => {
    setBrowserPermission(supportsBrowserNotifications ? Notification.permission : 'denied')
  }, [])

  useEffect(() => {
    if (
      !session ||
      view !== 'profile' ||
      session.user.role === 'ThirdParty' ||
      !userProfilesApi.isActive()
    ) {
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    void userProfilesApi
      .get(session.token, session.user.id)
      .then((bundle) => {
        if (cancelled) {
          return
        }
        setProfileBundle(bundle)
        setProfileForm(toProfileForm(bundle))
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Failed to load profile.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [session, view])

  useEffect(() => {
    if (!session || session.user.role !== 'ThirdParty' || view !== 'profile') {
      return
    }
    let cancelled = false
    setLoading(true)
    void vendorRegistrationApi
      .getMine(session.token)
      .then((record) => {
        if (!cancelled) setVendorRegistration(record)
      })
      .catch(() => {
        if (!cancelled) setVendorRegistration(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, view])

  useEffect(() => {
    if (view !== 'gamification') return
    setGamLoading(true)
    asquareGamificationApi
      .getConfig()
      .then(setGamConfig)
      .catch(() => {})
      .finally(() => setGamLoading(false))
  }, [view])

  // Booking-confirmation default template — load when the Template Images
  // view is opened (same screen where admins manage Interakt assets).
  useEffect(() => {
    if (view !== 'template-images') return
    setBookingConfirmLoading(true)
    bookingConfirmationConfigApi
      .get()
      .then((cfg) => {
        setBookingConfirmConfig(cfg)
        setBookingConfirmDraft({
          defaultTemplateId: cfg.defaultTemplateId,
          defaultTemplateLanguage: cfg.defaultTemplateLanguage,
        })
        setBookingConfirmError(null)
      })
      .catch((err: unknown) =>
        setBookingConfirmError(err instanceof Error ? err.message : 'Failed to load.'),
      )
      .finally(() => setBookingConfirmLoading(false))
  }, [view])

  const saveBookingConfirmConfig = async () => {
    if (!session?.token) return
    setBookingConfirmSaving(true)
    setBookingConfirmError(null)
    try {
      const next = await bookingConfirmationConfigApi.update(session.token, {
        defaultTemplateId: bookingConfirmDraft.defaultTemplateId.trim(),
        defaultTemplateLanguage: bookingConfirmDraft.defaultTemplateLanguage.trim(),
      })
      setBookingConfirmConfig(next)
      setSuccess('Booking-confirmation default template updated.')
    } catch (err: unknown) {
      setBookingConfirmError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setBookingConfirmSaving(false)
    }
  }

  const bookingConfirmDirty =
    bookingConfirmConfig != null &&
    (bookingConfirmDraft.defaultTemplateId.trim() !== bookingConfirmConfig.defaultTemplateId ||
      bookingConfirmDraft.defaultTemplateLanguage.trim() !==
        bookingConfirmConfig.defaultTemplateLanguage)

  const clearStatus = () => {
    setError(null)
    setSuccess(null)
  }

  const onUpdatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session) return
    const form = event.currentTarget

    const formData = new FormData(form)
    const oldPassword = String(formData.get('oldPassword') ?? '')
    const newPassword = String(formData.get('newPassword') ?? '')
    const confirmPassword = String(formData.get('confirmPassword') ?? '')

    clearStatus()
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password must match.')
      return
    }

    setLoading(true)
    try {
      await authApi.resetPassword(session.token, oldPassword, newPassword)
      setSuccess('Password updated successfully.')
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  const onSavePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session) return

    clearStatus()
    const normalizedNotificationSettings: UserNotificationSettings = {
      sound: preferences.notifications.sound,
      browserPushEnabled: preferences.notifications.browserPushEnabled,
      customSoundDataUrl:
        preferences.notifications.sound === 'custom'
          ? preferences.notifications.customSoundDataUrl
          : undefined,
    }

    try {
      setMode(currentTheme)
      await usersApi.update(session.token, session.user.id, {
        notificationSettings: normalizedNotificationSettings,
      })
      updateSessionUser({
        notificationSettings: normalizedNotificationSettings,
      })
      saveUserPreferences(session.user.id, {
        ...preferences,
        notifications: normalizedNotificationSettings,
      })
      setSuccess('Preferences saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences.')
    }
  }

  const onRequestBrowserNotifications = async () => {
    if (!supportsBrowserNotifications) {
      setError('Browser notifications are not supported in this browser.')
      return
    }
    clearStatus()
    try {
      const permission = await Notification.requestPermission()
      setBrowserPermission(permission)
      if (permission === 'granted') {
        setPreferences((current) => ({
          ...current,
          notifications: {
            ...current.notifications,
            browserPushEnabled: true,
          },
        }))
        setSuccess('Browser notifications enabled.')
      } else if (permission === 'denied') {
        setPreferences((current) => ({
          ...current,
          notifications: {
            ...current.notifications,
            browserPushEnabled: false,
          },
        }))
        setError(
          'Browser notifications were blocked. You can enable them from browser site settings.',
        )
      } else {
        setSuccess('Notification permission request dismissed.')
      }
    } catch {
      setError('Failed to request browser notification permission.')
    }
  }

  const onUploadCustomSound = (file: File | null) => {
    if (!file) {
      return
    }
    if (!file.type.startsWith('audio/')) {
      setError('Please select a valid audio file.')
      return
    }
    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      setError('Custom sound is too large. Please upload an audio file under 300 KB.')
      return
    }
    clearStatus()
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (!result) {
        setError('Failed to read audio file.')
        return
      }
      setPreferences((current) => ({
        ...current,
        notifications: {
          ...current.notifications,
          sound: 'custom',
          customSoundDataUrl: result,
        },
      }))
      setSuccess('Custom notification sound selected.')
    }
    reader.onerror = () => {
      setError('Failed to read audio file.')
    }
    reader.readAsDataURL(file)
  }

  const updateProfileField = <Key extends keyof ProfileFormState>(
    key: Key,
    value: ProfileFormState[Key],
  ) => {
    setProfileForm((current) => ({ ...current, [key]: value }))
  }

  const onUploadProfilePhoto = async (file: File | null) => {
    if (!file) {
      return
    }
    clearStatus()
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file for the display picture.')
      return
    }
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      setError('Profile photo is too large. Please upload an image under 350 KB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      updateProfileField('profilePhotoUrl', dataUrl)
      setSuccess('Display picture is ready to save.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to read profile photo.')
    }
  }

  const onSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session || !profileBundle) return

    clearStatus()
    setSavingProfile(true)
    try {
      let nextAccount = profileBundle.account
      const accountChanged =
        profileForm.name.trim() !== (profileBundle.account.name ?? '') ||
        profileForm.email.trim() !== (profileBundle.account.email ?? '') ||
        profileForm.phone.trim() !== (profileBundle.account.phone ?? '')

      if (accountChanged) {
        const result = await usersApi.update(session.token, session.user.id, {
          name: profileForm.name.trim(),
          email: profileForm.email.trim(),
          phone: profileForm.phone.trim(),
        })
        nextAccount = result.user
        updateSessionUser({
          name: result.user.name,
          email: result.user.email,
          phone: result.user.phone,
        })
      }

      const updatedBundle = await userProfilesApi.update(session.token, session.user.id, {
        profilePhotoUrl: profileForm.profilePhotoUrl.trim() || undefined,
        dob: profileForm.dob || undefined,
        gender: profileForm.gender || undefined,
        branchId: profileForm.branchId.trim() || undefined,
        aadharNumber: profileForm.aadharNumber.trim() || undefined,
        panNumber: profileForm.panNumber.trim() || undefined,
        bankAccountNumber: profileForm.bankAccountNumber.trim() || undefined,
        bankName: profileForm.bankName.trim() || undefined,
        ifscCode: profileForm.ifscCode.trim() || undefined,
      })

      const mergedBundle: UserProfileBundle = {
        ...updatedBundle,
        account: nextAccount,
      }
      setProfileBundle(mergedBundle)
      setProfileForm(toProfileForm(mergedBundle))
      setSuccess('Profile updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to update profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  // Gamification helpers
  const updateTask = (id: string, field: string, value: unknown) => {
    setGamConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        dailyTasks: prev.dailyTasks.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
      }
    })
  }

  const removeTask = (id: string) => {
    setGamConfig((prev) => {
      if (!prev) return prev
      return { ...prev, dailyTasks: prev.dailyTasks.filter((t) => t.id !== id) }
    })
  }

  const addTask = () => {
    setGamConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        dailyTasks: [
          ...prev.dailyTasks,
          {
            id: crypto.randomUUID(),
            name: '',
            reward: 0,
            rewardType: 'tires' as const,
            actionType: 'generic' as const,
          },
        ],
      }
    })
  }

  const updateAchievement = (id: string, field: string, value: unknown) => {
    setGamConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        achievements: prev.achievements.map((a) => (a.id === id ? { ...a, [field]: value } : a)),
      }
    })
  }

  const removeAchievement = (id: string) => {
    setGamConfig((prev) => {
      if (!prev) return prev
      return { ...prev, achievements: prev.achievements.filter((a) => a.id !== id) }
    })
  }

  const addAchievement = () => {
    setGamConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        achievements: [
          ...prev.achievements,
          { id: crypto.randomUUID(), name: '', icon: '', unlocked: false },
        ],
      }
    })
  }

  const handleSaveGamification = async () => {
    if (!gamConfig) return
    setGamSaving(true)
    try {
      await asquareGamificationApi.saveConfig(gamConfig)
      setSuccess('Gamification settings saved.')
    } catch {
      setError('Failed to save gamification settings.')
    } finally {
      setGamSaving(false)
    }
  }

  // ─── Devices handlers ──────────────────────────────────────────
  const loadDevices = useCallback(async () => {
    if (!session) return
    setDevicesLoading(true)
    try {
      const list = await deviceSessionsApi.listForUser(session.token)
      setDevices(list)
    } catch {
      setError('Failed to load devices.')
    } finally {
      setDevicesLoading(false)
    }
  }, [session])

  const loadAdminData = useCallback(async () => {
    if (!session || !isAdminUser) return
    setAdminUsersLoading(true)
    try {
      const [usersResult, allSessions] = await Promise.all([
        usersApi.list(session.token),
        deviceSessionsApi.listAllSessions(session.token),
      ])
      setAdminUsers(usersResult.users.filter((u) => u.isActive))
      setAdminAllSessions(allSessions)
    } catch {
      setError('Failed to load user sessions.')
    } finally {
      setAdminUsersLoading(false)
    }
  }, [session, isAdminUser])

  useEffect(() => {
    if (view === 'devices' && session) {
      void loadDevices()
      if (isAdminUser) {
        void loadAdminData()
      }
    }
  }, [view, session, loadDevices, loadAdminData, isAdminUser])

  const handleRevokeDevice = async (sessionId: string) => {
    if (!session) return
    setConfirmRevokeId(null)
    setRevokingId(sessionId)
    clearStatus()
    try {
      await deviceSessionsApi.revokeSession(session.token, sessionId)
      setDevices((prev) => prev.filter((d) => d.id !== sessionId))
      setSuccess('Device logged out successfully.')
    } catch {
      setError('Failed to log out device.')
    } finally {
      setRevokingId(null)
    }
  }

  const handleRevokeAllOther = async () => {
    if (!session || !currentSessionId) return
    setConfirmRevokeAll(false)
    setRevokingAll(true)
    clearStatus()
    try {
      const count = await deviceSessionsApi.revokeAllOtherSessions(session.token, currentSessionId)
      setDevices((prev) => prev.filter((d) => d.id === currentSessionId))
      setSuccess(`Logged out from ${count} other device${count !== 1 ? 's' : ''}.`)
    } catch {
      setError('Failed to log out other devices.')
    } finally {
      setRevokingAll(false)
    }
  }

  // ─── Admin device handlers ─────────────────────────────────────
  const handleAdminSelectUser = async (userId: string) => {
    if (!session) return
    setAdminSelectedUserId(userId)
    setAdminSelectedLoading(true)
    clearStatus()
    try {
      const sessions = await deviceSessionsApi.listSessionsForUser(session.token, userId)
      setAdminSelectedSessions(sessions)
    } catch {
      setError('Failed to load sessions for this user.')
    } finally {
      setAdminSelectedLoading(false)
    }
  }

  const handleAdminBackToList = () => {
    setAdminSelectedUserId(null)
    setAdminSelectedSessions([])
  }

  const handleAdminRevokeDevice = async (sessionId: string) => {
    if (!session) return
    // Look up the session's userId from whatever list it was rendered in so
    // we can ask the API to verify ownership before the write lands.
    const target =
      adminSelectedSessions.find((d) => d.id === sessionId) ??
      adminAllSessions.find((d) => d.id === sessionId)
    if (!target) {
      setError('Failed to revoke session.')
      return
    }
    setAdminConfirmRevokeId(null)
    setAdminRevokingId(sessionId)
    clearStatus()
    try {
      await deviceSessionsApi.adminRevokeSession(session.token, sessionId, target.userId)
      setAdminSelectedSessions((prev) => prev.filter((d) => d.id !== sessionId))
      setAdminAllSessions((prev) => prev.filter((d) => d.id !== sessionId))
      setSuccess('Device session revoked.')
    } catch {
      setError('Failed to revoke session.')
    } finally {
      setAdminRevokingId(null)
    }
  }

  const handleAdminRevokeAllForUser = async (userId: string) => {
    if (!session) return
    setAdminConfirmRevokeAllUser(null)
    setAdminRevokingAll(true)
    clearStatus()
    try {
      const count = await deviceSessionsApi.adminRevokeAllForUser(session.token, userId)
      setAdminSelectedSessions([])
      setAdminAllSessions((prev) => prev.filter((d) => d.userId !== userId))
      setSuccess(`Revoked ${count} session${count !== 1 ? 's' : ''} for this user.`)
    } catch {
      setError('Failed to revoke user sessions.')
    } finally {
      setAdminRevokingAll(false)
    }
  }

  // Build user summary list with session counts for admin view
  const adminUserSessionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of adminAllSessions) {
      counts.set(s.userId, (counts.get(s.userId) ?? 0) + 1)
    }
    return counts
  }, [adminAllSessions])

  const adminFilteredUsers = useMemo(() => {
    let list = adminUsers
    if (adminRoleFilter) {
      list = list.filter((u) => u.role === adminRoleFilter)
    }
    if (adminSearchQuery.trim()) {
      const q = adminSearchQuery.trim().toLowerCase()
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.phone ?? '').includes(q),
      )
    }
    return list.sort(
      (a, b) => (adminUserSessionCounts.get(b.id) ?? 0) - (adminUserSessionCounts.get(a.id) ?? 0),
    )
  }, [adminUsers, adminRoleFilter, adminSearchQuery, adminUserSessionCounts])

  const adminSelectedUser = adminSelectedUserId
    ? adminUsers.find((u) => u.id === adminSelectedUserId)
    : null

  // Check for suspicious patterns (multiple IPs for same user)
  const adminSuspiciousUserIds = useMemo(() => {
    const suspicious = new Set<string>()
    const userIps = new Map<string, Set<string>>()
    for (const s of adminAllSessions) {
      if (!s.ipAddress) continue
      if (!userIps.has(s.userId)) userIps.set(s.userId, new Set())
      userIps.get(s.userId)!.add(s.ipAddress)
    }
    for (const [userId, ips] of userIps) {
      if (ips.size >= 3) suspicious.add(userId)
    }
    return suspicious
  }, [adminAllSessions])

  // ─── Cross-user IP matching ─────────────────────────────────────────
  // Same IP appearing on a single user's own sessions is normal (one laptop,
  // many logins). Same IP across DIFFERENT user accounts is what this memo
  // tracks — and whether it's suspicious depends on who the users are.
  //
  // Flag "suspicious" only if the IP spans branches (can't both be on the
  // same office LAN) or it links a privileged role (Owner/Admin) to a
  // non-privileged one (Cashier/TrackMarshall/Telecaller) — that's the
  // credential-sharing signal the user asked about. Otherwise surface as
  // "expected" NAT overlap so office WiFi duplicates stay visible but don't
  // look like alerts.
  const adminUsersById = useMemo(() => {
    const map = new Map<string, UserRecord>()
    for (const u of adminUsers) map.set(u.id, u)
    return map
  }, [adminUsers])

  interface SharedIpRow {
    ip: string
    userIds: string[]
    userNames: string[]
    branches: string[]
    roles: Role[]
    flag: 'suspicious' | 'expected' | 'info'
    flagReason: string
    sessionCount: number
  }

  const adminSharedIps = useMemo<SharedIpRow[]>(() => {
    if (!isAdminUser) return []
    const NON_PRIVILEGED_OPS_ROLES: Role[] = ['Cashier', 'TrackMarshall', 'Telecaller', 'Incharge']
    // Bucket sessions by IP, record every user touching that IP.
    const byIp = new Map<string, { userIds: Set<string>; sessionCount: number }>()
    for (const s of adminAllSessions) {
      const ip = s.ipAddress?.trim()
      if (!ip) continue
      if (!byIp.has(ip)) byIp.set(ip, { userIds: new Set(), sessionCount: 0 })
      const bucket = byIp.get(ip)!
      bucket.userIds.add(s.userId)
      bucket.sessionCount += 1
    }

    const rows: SharedIpRow[] = []
    for (const [ip, { userIds, sessionCount }] of byIp) {
      // Single-user IPs aren't "shared" — suspiciousUserIds already flags
      // the multi-IP-per-user case separately.
      if (userIds.size < 2) continue

      const users = Array.from(userIds)
        .map((id) => adminUsersById.get(id))
        .filter((u): u is UserRecord => Boolean(u))
      const userNames = users.map((u) => u.name)
      const branches = Array.from(
        new Set(
          users
            .map((u) =>
              Array.isArray(u.allowedLocations) && u.allowedLocations.length > 0
                ? u.allowedLocations
                : ['__unrestricted__'],
            )
            .flat(),
        ),
      )
      const roles = Array.from(new Set(users.map((u) => u.role)))

      const distinctBranches = branches.filter((b) => b !== '__unrestricted__')
      const spansMultipleBranches = distinctBranches.length >= 2
      const hasPrivileged = roles.some((r) => r === 'Owner' || r === 'Admin')
      const hasOps = roles.some((r) => NON_PRIVILEGED_OPS_ROLES.includes(r))
      const crossesPrivilegeBoundary = hasPrivileged && hasOps

      let flag: SharedIpRow['flag']
      let flagReason: string
      if (spansMultipleBranches) {
        flag = 'suspicious'
        flagReason = `IP spans ${distinctBranches.length} branches — can't all be the same office LAN.`
      } else if (crossesPrivilegeBoundary) {
        flag = 'suspicious'
        flagReason =
          'IP links Owner/Admin accounts with operational roles — possible credential sharing.'
      } else if (distinctBranches.length === 1 || branches.includes('__unrestricted__')) {
        flag = 'expected'
        flagReason = 'Users share a branch or have multi-branch access — likely office NAT.'
      } else {
        flag = 'info'
        flagReason = 'Shared IP, no branch metadata available.'
      }

      rows.push({
        ip,
        userIds: Array.from(userIds),
        userNames,
        branches: distinctBranches,
        roles,
        flag,
        flagReason,
        sessionCount,
      })
    }

    // Sort: suspicious first (highest session count wins within a bucket).
    const severity: Record<SharedIpRow['flag'], number> = { suspicious: 0, info: 1, expected: 2 }
    rows.sort((a, b) => {
      const s = severity[a.flag] - severity[b.flag]
      if (s !== 0) return s
      return b.sessionCount - a.sessionCount
    })
    return rows
  }, [adminAllSessions, adminUsersById, isAdminUser])

  if (!session) {
    return null
  }

  return (
    <ModulePageLayout
      moduleTab="Settings"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Settings', titleMap[view]]}
      subnav={subnav}
    >
      {error ? (
        <p
          className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success"
          aria-live="polite"
        >
          {success}
        </p>
      ) : null}

      {view === 'profile' && session.user.role === 'ThirdParty' ? (
        <div className="space-y-4">
          <SummaryCards
            items={[
              { id: 'role', label: 'Role', value: 'Third Party Partner', tone: 'info' },
              {
                id: 'password-state',
                label: 'Password State',
                value: session.user.mustChangePassword ? 'Must Change' : 'Compliant',
                tone: session.user.mustChangePassword ? 'warning' : 'success',
              },
              { id: 'account-status', label: 'Account Status', value: 'Active', tone: 'success' },
              { id: 'access', label: 'Access Level', value: 'Partner Portal', tone: 'muted' },
            ]}
          />

          <DetailPanel title="Account Information">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                { label: 'Name', value: session.user.name },
                { label: 'Email', value: session.user.email ?? '—' },
                { label: 'Role', value: 'Third Party Partner' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-border/60 bg-surface/35 p-3">
                  <p className="text-xs uppercase tracking-[0.08em] text-muted">{label}</p>
                  <p className="mt-1 text-sm font-medium text-text break-words">{value}</p>
                </div>
              ))}
            </div>
          </DetailPanel>

          <DetailPanel title="Vendor Registration Details">
            {loading ? (
              <p className="text-sm text-muted">Loading vendor profile...</p>
            ) : vendorRegistration ? (
              <>
                <p className="mb-3 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-sm text-info">
                  These details were submitted during vendor registration. Contact Owner/Admin for
                  any updates.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { label: 'Vendor Name', value: vendorRegistration.vendorName },
                    { label: 'Company Name', value: vendorRegistration.companyName },
                    { label: 'Branch', value: getLocationShortName(vendorRegistration.branchId) },
                    { label: 'Mobile Number', value: vendorRegistration.mobileNumber },
                    { label: 'Email', value: vendorRegistration.email },
                    { label: 'GST Number', value: vendorRegistration.gstNumber || '—' },
                    { label: 'Address', value: vendorRegistration.address },
                    { label: 'Bank Account Number', value: vendorRegistration.bankAccountNumber },
                    { label: 'Bank Name', value: vendorRegistration.bankName },
                    { label: 'IFSC Code', value: vendorRegistration.ifscCode },
                    { label: 'Bank Branch', value: vendorRegistration.bankBranch },
                    {
                      label: 'Approved On',
                      value: vendorRegistration.reviewedAt
                        ? fmtDateIST(vendorRegistration.reviewedAt)
                        : '—',
                    },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="rounded-xl border border-border/60 bg-surface/35 p-3"
                    >
                      <p className="text-xs uppercase tracking-[0.08em] text-muted">{label}</p>
                      <p className="mt-1 text-sm font-medium text-text break-words">{value}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                No vendor registration details found. Please contact Owner/Admin.
              </p>
            )}
          </DetailPanel>
        </div>
      ) : null}

      {view === 'profile' && session.user.role !== 'ThirdParty' ? (
        <>
          <SummaryCards
            items={[
              {
                id: 'completion',
                label: 'Profile Completion',
                value: `${profileBundle?.profile.profileCompletionPercent ?? 0}%`,
                tone: 'success',
              },
              { id: 'role', label: 'Role', value: session.user.role, tone: 'info' },
              {
                id: 'password-state',
                label: 'Password State',
                value: session.user.mustChangePassword ? 'Must Change' : 'Compliant',
                tone: session.user.mustChangePassword ? 'warning' : 'success',
              },
              { id: 'security', label: 'Security Model', value: 'Masked Only', tone: 'warning' },
            ]}
          />

          <form className="mt-4 space-y-4" onSubmit={onSaveProfile}>
            <DetailPanel title="Profile Completion">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr,1.1fr]">
                <div className="rounded-2xl border border-border bg-panel/50 p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex size-24 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface">
                      {profileForm.profilePhotoUrl ? (
                        <img
                          src={profileForm.profilePhotoUrl}
                          alt="Profile preview"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl font-semibold text-muted">
                          {session.user.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-text">Display Picture</p>
                      <label className="inline-flex cursor-pointer items-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text">
                        Upload DP
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) =>
                            void onUploadProfilePhoto(event.target.files?.[0] ?? null)
                          }
                        />
                      </label>
                      <p className="text-xs text-muted">
                        Stored directly in the profile document for now. Keep the image compact.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-accent/25 bg-accent/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-text">Completion Progress</p>
                      <p className="text-sm font-semibold text-accent">
                        {profileBundle?.profile.profileCompletionPercent ?? 0}%
                      </p>
                    </div>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-accent transition-[width]"
                        style={{
                          width: `${Math.max(0, Math.min(100, profileBundle?.profile.profileCompletionPercent ?? 0))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      Completion checks photo, name, email, phone, DOB, gender, Aadhaar, PAN, bank
                      name, account number, and IFSC.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-warning/35 bg-warning/10 p-4">
                  <p className="text-sm font-semibold text-text">Security Notice</p>
                  <p className="mt-2 text-sm text-muted">
                    {profileBundle?.profile.securityNotice ??
                      'Sensitive profile data is masked in the app UI, but the current authentication/session model is not a secure KYC-grade backend yet.'}
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border bg-surface px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Aadhaar</p>
                      <p className="mt-1 text-sm font-semibold text-text">
                        {profileBundle?.maskedSensitive.aadharNumber ?? '-'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-surface px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">PAN</p>
                      <p className="mt-1 text-sm font-semibold text-text">
                        {profileBundle?.maskedSensitive.panNumber ?? '-'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-surface px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">
                        Bank Account
                      </p>
                      <p className="mt-1 text-sm font-semibold text-text">
                        {profileBundle?.maskedSensitive.bankAccountNumber ?? '-'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </DetailPanel>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <DetailPanel title="Personal Details">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Full Name
                    <input
                      className="ui-field min-h-10"
                      value={profileForm.name}
                      onChange={(event) => updateProfileField('name', event.target.value)}
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Email
                    <input
                      className="ui-field min-h-10"
                      type="email"
                      value={profileForm.email}
                      onChange={(event) => updateProfileField('email', event.target.value)}
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Mobile Number
                    <input
                      className="ui-field min-h-10"
                      value={profileForm.phone}
                      onChange={(event) => updateProfileField('phone', event.target.value)}
                      placeholder="10-digit phone"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Date Of Birth
                    <input
                      className="ui-field min-h-10"
                      type="date"
                      value={profileForm.dob}
                      onChange={(event) => updateProfileField('dob', event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Gender
                    <select
                      className="ui-field min-h-10"
                      value={profileForm.gender}
                      onChange={(event) =>
                        updateProfileField('gender', event.target.value as '' | UserGender)
                      }
                    >
                      <option value="">Select gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Branch
                    <select
                      className="ui-field min-h-10"
                      value={profileForm.branchId}
                      onChange={(event) => updateProfileField('branchId', event.target.value)}
                    >
                      <option value="">Select branch</option>
                      {getAllLocations().map((loc) => (
                        <option key={loc.branchId} value={loc.branchId}>
                          {loc.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </DetailPanel>

              <DetailPanel title="KYC And Bank Details">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Aadhaar Number
                    <input
                      className="ui-field min-h-10"
                      value={profileForm.aadharNumber}
                      onChange={(event) => updateProfileField('aadharNumber', event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    PAN Number
                    <input
                      className="ui-field min-h-10"
                      value={profileForm.panNumber}
                      onChange={(event) =>
                        updateProfileField('panNumber', event.target.value.toUpperCase())
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Bank Name
                    <input
                      className="ui-field min-h-10"
                      value={profileForm.bankName}
                      onChange={(event) => updateProfileField('bankName', event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                    Account Number
                    <input
                      className="ui-field min-h-10"
                      value={profileForm.bankAccountNumber}
                      onChange={(event) =>
                        updateProfileField('bankAccountNumber', event.target.value)
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted md:col-span-2">
                    IFSC Code
                    <input
                      className="ui-field min-h-10"
                      value={profileForm.ifscCode}
                      onChange={(event) =>
                        updateProfileField('ifscCode', event.target.value.toUpperCase())
                      }
                    />
                  </label>
                </div>
              </DetailPanel>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={savingProfile || loading}
                className="rounded-lg border border-accent/45 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent disabled:opacity-70"
              >
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-text"
                onClick={() => {
                  if (profileBundle) {
                    setProfileForm(toProfileForm(profileBundle))
                  }
                  clearStatus()
                }}
              >
                Reset Changes
              </button>
            </div>
          </form>
        </>
      ) : null}

      {view === 'password' ? (
        <DetailPanel title="Reset Password">
          <form className="grid max-w-2xl grid-cols-1 gap-3" onSubmit={onUpdatePassword}>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
              Current Password
              <input
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text"
                name="oldPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
              New Password
              <input
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
              Confirm New Password
              <input
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-fit rounded-lg border border-accent/45 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent disabled:opacity-70"
            >
              Update Password
            </button>
          </form>
        </DetailPanel>
      ) : null}

      {view === 'preferences' ? (
        <DetailPanel title="UI Preferences">
          <form
            className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-2"
            onSubmit={onSavePreferences}
          >
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
              Theme
              <select
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text"
                value={currentTheme}
                onChange={(event) => setCurrentTheme(event.target.value as ThemeMode)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
              Default Tab
              <select
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text"
                value={preferences.defaultTabPath}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    defaultTabPath: event.target.value,
                  }))
                }
              >
                {availableTabs.map((tab) => (
                  <option key={tab.id} value={tab.path}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text">
              <input
                type="checkbox"
                checked={preferences.compactDensity}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    compactDensity: event.target.checked,
                  }))
                }
              />
              Use compact table density
            </label>

            <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text">
              <input
                type="checkbox"
                checked={preferences.emailDigest}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    emailDigest: event.target.checked,
                  }))
                }
              />
              Enable daily activity digest
            </label>

            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.07em] text-muted">
              Notification Sound
              <select
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text"
                value={preferences.notifications.sound}
                onChange={(event) => {
                  const nextSound = event.target.value as NotificationSound
                  setPreferences((current) => ({
                    ...current,
                    notifications: {
                      ...current.notifications,
                      sound: nextSound,
                    },
                  }))
                }}
              >
                <option value="soft">Soft Ping (Default)</option>
                <option value="chime">Chime</option>
                <option value="bell">Bell</option>
                <option value="custom">Custom Upload</option>
                <option value="off">Mute</option>
              </select>
            </label>

            <div className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text">
              <p className="text-xs font-semibold uppercase tracking-[0.07em] text-muted">
                Custom Sound Upload
              </p>
              <input
                type="file"
                accept="audio/*"
                className="mt-2 block w-full text-xs text-text file:mr-2 file:rounded-md file:border file:border-border/80 file:bg-surface file:px-2 file:py-1 file:text-xs file:font-semibold file:text-text"
                onChange={(event) => onUploadCustomSound(event.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-muted">
                {preferences.notifications.customSoundDataUrl
                  ? 'Custom sound is ready.'
                  : 'Upload MP3/WAV/OGG. This is stored locally on this browser.'}
              </p>
            </div>

            <div className="col-span-1 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text md:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={preferences.notifications.browserPushEnabled}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setPreferences((current) => ({
                        ...current,
                        notifications: {
                          ...current.notifications,
                          browserPushEnabled: checked,
                        },
                      }))
                    }}
                  />
                  Show browser notification when tab is hidden
                </label>
                <button
                  type="button"
                  onClick={() => void onRequestBrowserNotifications()}
                  className="ui-btn ui-btn-info min-h-8 px-3 py-1 text-xs"
                  disabled={!supportsBrowserNotifications}
                >
                  Enable Browser Alerts
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">Browser permission: {browserPermission}</p>
            </div>

            <div className="col-span-1 flex flex-wrap gap-2 md:col-span-2">
              <button
                type="submit"
                className="rounded-lg border border-accent/45 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent"
              >
                Save Preferences
              </button>
              <button
                type="button"
                className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-text"
                onClick={() => {
                  const defaultTabPath = availableTabs[0]?.path ?? '/dashboard'
                  setCurrentTheme('dark')
                  setPreferences(createDefaultUserPreferences(defaultTabPath))
                  clearStatus()
                }}
              >
                Reset Local Defaults
              </button>
            </div>
          </form>
        </DetailPanel>
      ) : null}

      {view === 'gamification' ? (
        <div className="space-y-6">
          <DetailPanel title="Daily Tasks">
            {gamLoading ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : gamConfig ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Reward</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamConfig.dailyTasks.map((task) => (
                        <tr key={task.id} className="border-b border-border/50">
                          <td className="px-3 py-2">
                            <input
                              className="ui-field min-h-9 w-full"
                              value={task.name}
                              onChange={(e) => updateTask(task.id, 'name', e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className="ui-field min-h-9 w-24"
                              value={task.reward}
                              onChange={(e) =>
                                updateTask(task.id, 'reward', Number(e.target.value))
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="ui-field min-h-9"
                              value={task.rewardType}
                              onChange={(e) => updateTask(task.id, 'rewardType', e.target.value)}
                            >
                              <option value="tires">Tires</option>
                              <option value="wallet">Wallet</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="ui-field min-h-9"
                              value={task.actionType}
                              onChange={(e) => updateTask(task.id, 'actionType', e.target.value)}
                            >
                              <option value="generic">Generic</option>
                              <option value="share">Share</option>
                              <option value="social_follow">Social Follow</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => removeTask(task.id)}
                              className="text-xs text-critical hover:underline"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={addTask}
                  className="mt-3 ui-btn ui-btn-neutral text-sm"
                >
                  + Add Task
                </button>
              </>
            ) : null}
          </DetailPanel>

          <DetailPanel title="Achievements">
            {gamConfig ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Icon</th>
                        <th className="px-3 py-2">Unlocked</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamConfig.achievements.map((a) => (
                        <tr key={a.id} className="border-b border-border/50">
                          <td className="px-3 py-2">
                            <input
                              className="ui-field min-h-9 w-full"
                              value={a.name}
                              onChange={(e) => updateAchievement(a.id, 'name', e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="ui-field min-h-9 w-20"
                              value={a.icon}
                              onChange={(e) => updateAchievement(a.id, 'icon', e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={a.unlocked}
                              onChange={(e) =>
                                updateAchievement(a.id, 'unlocked', e.target.checked)
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => removeAchievement(a.id)}
                              className="text-xs text-critical hover:underline"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={addAchievement}
                  className="mt-3 ui-btn ui-btn-neutral text-sm"
                >
                  + Add Achievement
                </button>
              </>
            ) : null}
          </DetailPanel>

          <button
            type="button"
            onClick={handleSaveGamification}
            className="ui-btn ui-btn-primary"
            disabled={gamSaving || !gamConfig}
          >
            {gamSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      ) : null}

      {view === 'devices' ? (
        <div className="space-y-4">
          <SummaryCards
            items={[
              {
                id: 'total',
                label: 'Active Devices',
                value: devicesLoading && devices.length === 0 ? 'Loading…' : String(devices.length),
                tone: 'info',
              },
              {
                id: 'current',
                label: 'Current Device',
                // Distinguish "still loading" from "loaded but current session
                // isn't registered yet" — the old "—" fallback conflated the
                // two and made a normal loading state look like an error.
                value:
                  devicesLoading && devices.length === 0
                    ? 'Loading…'
                    : (devices.find((d) => d.id === currentSessionId)?.browserName ??
                      'Not registered'),
                tone: 'success',
              },
            ]}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-neutral text-sm"
              onClick={() => void loadDevices()}
              disabled={devicesLoading}
            >
              {devicesLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            {devices.length > 1 ? (
              <button
                type="button"
                className="ui-btn ui-btn-danger text-sm"
                onClick={() => setConfirmRevokeAll(true)}
                disabled={revokingAll}
              >
                {revokingAll ? 'Logging out...' : 'Logout from all other devices'}
              </button>
            ) : null}
          </div>

          {devicesLoading && devices.length === 0 ? (
            <p className="text-sm text-muted">Loading devices...</p>
          ) : devices.length === 0 ? (
            <DetailPanel title="No Active Sessions">
              <p className="text-sm text-muted">
                No active device sessions found. Sessions will appear here on your next login.
              </p>
            </DetailPanel>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {devices.map((device) => {
                const isCurrent = device.id === currentSessionId
                const isRevoking = revokingId === device.id
                return (
                  <div
                    key={device.id}
                    className={`rounded-xl border p-4 ${isCurrent ? 'border-accent/45 bg-accent/5' : 'border-border/60 bg-panel'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-surface text-muted">
                          {device.deviceType === 'mobile' ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                              <path d="M12 18h.01" />
                            </svg>
                          ) : device.deviceType === 'tablet' ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
                              <line x1="12" x2="12.01" y1="18" y2="18" />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect width="20" height="14" x="2" y="3" rx="2" />
                              <line x1="8" x2="16" y1="21" y2="21" />
                              <line x1="12" x2="12" y1="17" y2="21" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-text">
                            {device.browserName} on {device.osName}
                          </p>
                          <p className="text-xs text-muted capitalize">{device.deviceType}</p>
                        </div>
                      </div>
                      {isCurrent ? (
                        <span className="shrink-0 rounded-full border border-accent/35 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                          This Device
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs text-muted">
                      {device.ipAddress ? (
                        <div className="flex items-center gap-1.5">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M2 12h20" />
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                          </svg>
                          <span>IP: {device.ipAddress}</span>
                        </div>
                      ) : null}
                      <div className="flex items-center gap-1.5">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                          <polyline points="10 17 15 12 10 7" />
                          <line x1="15" x2="3" y1="12" y2="12" />
                        </svg>
                        <span>Logged in: {fmtDateTimeFullIST(device.loginAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>Last active: {fmtDateTimeFullIST(device.lastActiveAt)}</span>
                      </div>
                    </div>

                    {!isCurrent ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(device.id)}
                        disabled={isRevoking}
                        className="mt-3 w-full rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs font-semibold text-critical disabled:opacity-60"
                      >
                        {isRevoking ? 'Logging out...' : 'Logout this device'}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          {/* ─── Admin: Shared IP Addresses ────────────────────────── */}
          {isAdminUser && adminSharedIps.length > 0 ? (
            <DetailPanel title="Shared IP Addresses">
              <p className="mb-2 text-xs text-muted">
                An IP appearing across multiple user accounts is usually legitimate (shared office
                Wi-Fi / NAT). The rows flagged as <em>Suspicious</em>
                span different branches or link privileged roles (Owner / Admin) to operational ones
                — patterns worth investigating.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-muted">
                      <th className="px-2 py-2 font-semibold">IP</th>
                      <th className="px-2 py-2 font-semibold">Users</th>
                      <th className="px-2 py-2 font-semibold">Branches</th>
                      <th className="px-2 py-2 font-semibold">Roles</th>
                      <th className="px-2 py-2 font-semibold">Sessions</th>
                      <th className="px-2 py-2 font-semibold">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminSharedIps.map((row) => {
                      const flagClass =
                        row.flag === 'suspicious'
                          ? 'border-critical/40 bg-critical/10 text-critical'
                          : row.flag === 'expected'
                            ? 'border-success/35 bg-success/10 text-success'
                            : 'border-info/35 bg-info/10 text-info'
                      const flagLabel =
                        row.flag === 'suspicious'
                          ? 'Suspicious'
                          : row.flag === 'expected'
                            ? 'Expected NAT'
                            : 'Info'
                      return (
                        <tr key={row.ip} className="border-b border-border/40 align-top">
                          <td className="px-2 py-2 font-mono text-text">{row.ip}</td>
                          <td className="px-2 py-2 text-text">
                            {row.userNames.length > 0 ? row.userNames.join(', ') : '—'}
                          </td>
                          <td className="px-2 py-2 text-muted">
                            {row.branches.length > 0
                              ? row.branches.join(', ')
                              : 'Multi / Unrestricted'}
                          </td>
                          <td className="px-2 py-2 text-muted">{row.roles.join(', ')}</td>
                          <td className="px-2 py-2 text-muted">{row.sessionCount}</td>
                          <td className="px-2 py-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${flagClass}`}
                              title={row.flagReason}
                            >
                              {flagLabel}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </DetailPanel>
          ) : null}

          {/* ─── Admin: User Device Management ─────────────────────── */}
          {isAdminUser ? (
            <DetailPanel title="User Device Management">
              {adminUsersLoading && adminUsers.length === 0 ? (
                <p className="text-sm text-muted">Loading users...</p>
              ) : adminSelectedUserId && adminSelectedUser ? (
                /* ── Drill-down: selected user's sessions ── */
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="ui-btn ui-btn-neutral text-sm"
                      onClick={handleAdminBackToList}
                    >
                      &larr; Back to users
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text">
                        {adminSelectedUser.name}
                      </span>
                      <span className="rounded-full border border-info/35 bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">
                        {adminSelectedUser.role}
                      </span>
                    </div>
                    {adminSelectedSessions.length > 0 ? (
                      <button
                        type="button"
                        className="ui-btn ui-btn-danger text-sm"
                        onClick={() => setAdminConfirmRevokeAllUser(adminSelectedUserId)}
                        disabled={adminRevokingAll}
                      >
                        {adminRevokingAll ? 'Revoking...' : 'Logout all devices'}
                      </button>
                    ) : null}
                  </div>

                  {adminSelectedLoading ? (
                    <p className="text-sm text-muted">Loading sessions...</p>
                  ) : adminSelectedSessions.length === 0 ? (
                    <p className="rounded-lg border border-border/60 bg-surface/30 px-4 py-3 text-sm text-muted">
                      No active sessions for this user.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {adminSelectedSessions.map((device) => {
                        const isRevoking = adminRevokingId === device.id
                        return (
                          <div
                            key={device.id}
                            className="rounded-xl border border-border/60 bg-panel p-4"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-surface text-muted">
                                {device.deviceType === 'mobile' ? (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                                    <path d="M12 18h.01" />
                                  </svg>
                                ) : device.deviceType === 'tablet' ? (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
                                    <line x1="12" x2="12.01" y1="18" y2="18" />
                                  </svg>
                                ) : (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <rect width="20" height="14" x="2" y="3" rx="2" />
                                    <line x1="8" x2="16" y1="21" y2="21" />
                                    <line x1="12" x2="12" y1="17" y2="21" />
                                  </svg>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-text">
                                  {device.browserName} on {device.osName}
                                </p>
                                <p className="text-xs text-muted capitalize">{device.deviceType}</p>
                              </div>
                            </div>
                            <div className="mt-3 space-y-1 text-xs text-muted">
                              {device.ipAddress ? <p>IP: {device.ipAddress}</p> : null}
                              <p>Logged in: {fmtDateTimeFullIST(device.loginAt)}</p>
                              <p>Last active: {fmtDateTimeFullIST(device.lastActiveAt)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAdminConfirmRevokeId(device.id)}
                              disabled={isRevoking}
                              className="mt-3 w-full rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs font-semibold text-critical disabled:opacity-60"
                            >
                              {isRevoking ? 'Revoking...' : 'Revoke session'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ── User list with search / filter ── */
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="Search by name, email, or phone..."
                      className="ui-field min-h-10 flex-1 min-w-[200px]"
                      value={adminSearchQuery}
                      onChange={(e) => setAdminSearchQuery(e.target.value)}
                    />
                    <select
                      className="ui-field min-h-10"
                      value={adminRoleFilter}
                      onChange={(e) => setAdminRoleFilter(e.target.value as Role | '')}
                    >
                      <option value="">All Roles</option>
                      <option value="Owner">Owner</option>
                      <option value="Admin">Admin</option>
                      <option value="Cashier">Cashier</option>
                      <option value="Telecaller">Telecaller</option>
                      <option value="TrackMarshall">TrackMarshall</option>
                      <option value="Editor">Editor</option>
                      <option value="Developer">Developer</option>
                      <option value="Backend">Backend</option>
                      <option value="ThirdParty">ThirdParty</option>
                    </select>
                    <button
                      type="button"
                      className="ui-btn ui-btn-neutral text-sm"
                      onClick={() => void loadAdminData()}
                      disabled={adminUsersLoading}
                    >
                      {adminUsersLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>

                  {adminFilteredUsers.length === 0 ? (
                    <p className="text-sm text-muted">No users match your filters.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-3 py-2">User</th>
                            <th className="px-3 py-2">Role</th>
                            <th className="px-3 py-2">Active Devices</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminFilteredUsers.map((user) => {
                            const deviceCount = adminUserSessionCounts.get(user.id) ?? 0
                            const isSuspicious = adminSuspiciousUserIds.has(user.id)
                            return (
                              <tr
                                key={user.id}
                                className="border-b border-border/40 hover:bg-surface/30"
                              >
                                <td className="px-3 py-2.5">
                                  <p className="font-medium text-text">{user.name}</p>
                                  <p className="text-xs text-muted">{user.email}</p>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">
                                    {user.role}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span
                                    className={`font-semibold ${deviceCount > 0 ? 'text-text' : 'text-muted'}`}
                                  >
                                    {deviceCount} device{deviceCount !== 1 ? 's' : ''}
                                  </span>
                                  {isSuspicious ? (
                                    <span
                                      className="ml-1.5 rounded-full border border-warning/35 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning"
                                      title="3+ distinct IPs detected"
                                    >
                                      !
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {deviceCount > 0 ? (
                                    <button
                                      type="button"
                                      className="ui-btn ui-btn-neutral min-h-8 px-3 text-xs"
                                      onClick={() => void handleAdminSelectUser(user.id)}
                                    >
                                      View
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted">—</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </DetailPanel>
          ) : null}

          <ConfirmDialog
            open={confirmRevokeId !== null}
            title="Logout Device"
            description="Are you sure you want to log out this device? The session will be terminated immediately."
            confirmLabel="Logout"
            onConfirm={() => confirmRevokeId && void handleRevokeDevice(confirmRevokeId)}
            onCancel={() => setConfirmRevokeId(null)}
          />

          <ConfirmDialog
            open={confirmRevokeAll}
            title="Logout All Other Devices"
            description="This will log out all devices except the current one. All other sessions will be terminated immediately."
            confirmLabel="Logout All"
            onConfirm={() => void handleRevokeAllOther()}
            onCancel={() => setConfirmRevokeAll(false)}
          />

          <ConfirmDialog
            open={adminConfirmRevokeId !== null}
            title="Revoke Session"
            description="Are you sure you want to revoke this device session? The user will be logged out immediately on that device."
            confirmLabel="Revoke"
            onConfirm={() =>
              adminConfirmRevokeId && void handleAdminRevokeDevice(adminConfirmRevokeId)
            }
            onCancel={() => setAdminConfirmRevokeId(null)}
          />

          <ConfirmDialog
            open={adminConfirmRevokeAllUser !== null}
            title="Revoke All Sessions"
            description="This will log out the user from all devices immediately. They will need to log in again."
            confirmLabel="Revoke All"
            onConfirm={() =>
              adminConfirmRevokeAllUser &&
              void handleAdminRevokeAllForUser(adminConfirmRevokeAllUser)
            }
            onCancel={() => setAdminConfirmRevokeAllUser(null)}
          />
        </div>
      ) : null}

      {view === 'template-images' ? (
        <div className="space-y-6">
          <DetailPanel title="Booking Confirmation — Default Template">
            <p className="mb-4 text-sm text-muted">
              Approved Interakt template used for the booking-confirmation WhatsApp when an activity
              has no per-sub-game override. Set the per-sub-game template under{' '}
              <span className="font-semibold">Activities → Sub Game → Booking Confirmation</span>.
            </p>
            {bookingConfirmLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                  <div>
                    <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                      Default template ID
                    </p>
                    <input
                      type="text"
                      value={bookingConfirmDraft.defaultTemplateId}
                      onChange={(e) =>
                        setBookingConfirmDraft((d) => ({
                          ...d,
                          defaultTemplateId: e.target.value,
                        }))
                      }
                      placeholder="e.g. booking_confirmed_ticket"
                      className="ui-field min-h-11 w-full font-mono text-sm"
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
                      Default language
                    </p>
                    <input
                      type="text"
                      value={bookingConfirmDraft.defaultTemplateLanguage}
                      onChange={(e) =>
                        setBookingConfirmDraft((d) => ({
                          ...d,
                          defaultTemplateLanguage: e.target.value,
                        }))
                      }
                      placeholder="en"
                      className="ui-field min-h-11 w-full font-mono text-sm"
                    />
                  </div>
                </div>
                {bookingConfirmError ? (
                  <p className="text-xs text-critical">{bookingConfirmError}</p>
                ) : null}
                {bookingConfirmConfig?.updatedAt ? (
                  <p className="text-xs text-muted">
                    Last updated {fmtDateTimeFullIST(bookingConfirmConfig.updatedAt)}
                    {bookingConfirmConfig.updatedBy ? ` by ${bookingConfirmConfig.updatedBy}` : ''}.
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveBookingConfirmConfig()}
                    disabled={
                      !bookingConfirmDirty ||
                      bookingConfirmSaving ||
                      !bookingConfirmDraft.defaultTemplateId.trim() ||
                      !bookingConfirmDraft.defaultTemplateLanguage.trim()
                    }
                    className="ui-btn ui-btn-primary min-h-9 px-4 text-xs"
                  >
                    {bookingConfirmSaving ? 'Saving…' : 'Save default'}
                  </button>
                </div>
              </div>
            )}
          </DetailPanel>

          <DetailPanel title="Interakt Template Header Images">
            <p className="mb-4 text-sm text-muted">
              Header images for WhatsApp notification templates. Images are served from{' '}
              <code className="text-xs bg-panel px-1.5 py-0.5 rounded">public/interakt/</code>. To
              update, replace the file and redeploy.
            </p>
            <div className="grid gap-3">
              {TEMPLATE_LIST.map((template) => (
                <div
                  key={template.templateName}
                  className="flex items-center gap-4 rounded-xl border border-border bg-panel/30 p-3"
                >
                  <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-surface">
                    <img
                      src={`/interakt/${template.fileName}`}
                      alt={template.label}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text">{template.label}</p>
                    <p className="text-xs text-muted">{template.templateName}</p>
                    <p className="text-xs text-muted/60 truncate">/interakt/{template.fileName}</p>
                  </div>
                </div>
              ))}
            </div>
          </DetailPanel>
        </div>
      ) : null}

      {view === 'tickets-categories' ? <TicketCategoriesSettings /> : null}
      {view === 'tickets-kb' ? <TicketKbSettings /> : null}
      {view === 'tickets-canned' ? <TicketCannedSettings /> : null}
    </ModulePageLayout>
  )
}

export default SettingsModule
