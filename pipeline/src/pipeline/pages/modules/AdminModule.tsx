import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { adminApi } from '../../api/admin'
import {
  AsquareCustomer,
  asquareCustomersApi,
  type ListCustomersSortBy,
} from '../../api/asquare-customers'
import { AsquareLocationWithMetrics, asquareLocationsApi } from '../../api/asquare-locations'
import { getLocationShortName } from '../../../lib/locations'
import { AsquareNotification, asquareNotificationsApi } from '../../api/asquare-notifications'
import { telecallerPerformanceApi } from '../../api/telecaller-performance'
import { vendorDetailsApi } from '../../api/vendor-details'
import { vendorRegistrationApi } from '../../api/vendor-registration'
import { usersApi } from '../../api/users'
import { logger } from '../../../lib/logger'
import {
  NotificationSound,
  Role,
  TelecallerMonthlyPerformanceRecord,
  TelecallerMonthlyPlanRecord,
  UserRecord,
  VendorDetailsRecord,
  VendorRegistrationRecord,
} from '../../api/types'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable } from '../../components/ui/DataTable'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { FilterBar, FilterField } from '../../components/ui/FilterBar'
import { useAuth } from '../../features/auth/auth-context'
import { useToast } from '../../features/toast/toast-context'
import { useLocations } from '../../hooks/useLocations'
import { fmtDateTimeFullIST, fmtDateIST } from '../../../lib/date-format'
import { Lock, ShieldBan, ShieldCheck, Star, Plus, Minus } from 'lucide-react'
import {
  lookupCustomerByPhone,
  toggleCustomerLock,
  toggleCustomerVerified,
  toggleCustomerInfluencer,
  toggleCustomerBlacklist,
  getCustomerWalletHistory,
  type CustomerControlsData,
  type WalletTransaction,
} from '../../api/customer-controls'
import { walletService } from '../../../services/walletService'

export type AdminView =
  | 'users'
  | 'audit'
  | 'roles'
  | 'telecallers'
  | 'vendors'
  | 'registrations'
  | 'customers'
  | 'locations'
  | 'notifications'
  | 'customer-controls'

const subnav = [
  { label: 'Users', to: '/admin/users' },
  { label: 'Audit', to: '/admin/audit' },
  { label: 'Roles', to: '/admin/roles' },
  { label: 'Vendor Forms', to: '/admin/vendors' },
  { label: 'Vendor Requests', to: '/admin/registrations' },
  { label: 'Customers', to: '/admin/customers' },
  { label: 'Locations', to: '/admin/locations' },
  { label: 'Notifications', to: '/admin/notifications' },
  { label: 'Customer Controls', to: '/admin/customer-controls' },
]

// When AdminModule renders the Telecallers view from the Incentives URL, it
// re-themes to match the Incentives module — same subnav as IncentivesModule
// plus the Telecallers tab, same breadcrumb parent.
const incentivesSubnav = (isAdmin: boolean) => {
  const items = [
    { label: 'Dashboard', to: '/incentives/dashboard' },
    { label: 'Weekly Report', to: '/incentives/weekly' },
    { label: 'Telecallers', to: '/incentives/telecallers' },
  ]
  if (isAdmin) {
    items.push(
      { label: 'Cashier Breakdown', to: '/incentives/cashiers' },
      { label: 'Config', to: '/incentives/config' },
    )
  }
  return items
}

const roleCapabilityRows: Array<{ role: Role; capabilities: string }> = [
  { role: 'Owner', capabilities: 'Full system access, user governance, analytics, settings' },
  {
    role: 'Admin',
    capabilities: 'Operational management, user provisioning, billing/lead oversight',
  },
  { role: 'Telecaller', capabilities: 'Lead claim, feedback, shift tracking, tasks' },
  { role: 'Cashier', capabilities: 'POS transactions, invoices, refunds, shift tracking' },
  {
    role: 'TrackMarshall',
    capabilities: 'Kart/session control, queue management, incidents, shifts',
  },
  {
    role: 'Incharge',
    capabilities:
      'Daily incharge tasks (washroom, housekeeping, vehicle report), branch operations, shift tracking',
  },
  { role: 'Editor', capabilities: 'Workspace tasks, media uploads, collaboration workflows' },
  {
    role: 'Developer',
    capabilities: 'Audit visibility, reporting, diagnostics and system oversight',
  },
  {
    role: 'Backend',
    capabilities: 'API/backend monitoring, logs, release checks, and system reliability',
  },
  {
    role: 'ThirdParty',
    capabilities:
      'Partner-facing access to reports, operations visibility, and integration diagnostics',
  },
  {
    role: 'HR',
    capabilities:
      'Staff scheduling, attendance, leave / overtime approvals, incentives review, scoped user provisioning',
  },
  {
    role: 'Accountant',
    capabilities:
      'Vendor settlements, GST exports, reconciliation, refund approvals, financial reporting (view-only on billing/bookings)',
  },
]

const roleOptions: Role[] = roleCapabilityRows.map((row) => row.role)
const adminManageableRoles: Role[] = [
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Incharge',
  'Editor',
  'Developer',
  'Backend',
  'ThirdParty',
  // Admin can promote a staff member to HR or Accountant (mid-tier
  // operational roles). Owner-only roles (Owner / Admin) are still
  // excluded — Admin can't mint another Admin.
  'HR',
  'Accountant',
]
// HR can only provision operational staff. NEVER Owner / Admin / fellow
// HR / Accountant / system roles. Mirrors the BambooHR-style scoped
// provisioning pattern.
const hrManageableRoles: Role[] = [
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Incharge',
  'Editor',
]
const notificationSoundOptions: NotificationSound[] = ['soft', 'chime', 'bell', 'off', 'custom']
const formatCurrency = (value: number): string =>
  `INR ${Math.round(value || 0).toLocaleString('en-IN')}`

interface UserEditDraft {
  name: string
  username: string
  email: string
  phone: string
  role: Role
  isActive: boolean
  workspaceIdsText: string
  notificationSound: NotificationSound
  browserPushEnabled: boolean
  customSoundDataUrl: string
  allowedLocations: string[]
  maxDiscountPercent: number
}

interface UserManagementPolicy {
  canManage: boolean
  canEditRole: boolean
  canToggleStatus: boolean
  canDelete: boolean
  allowedRoles: Role[]
  summary: string
}

interface TelecallerPlanEditDraft {
  telecallerId: string
  monthKey: string
  targetAmount: string
  /** Blank = fall back to the global default percent. */
  incentivePercent: string
}

const buildUserEditDraft = (user: UserRecord): UserEditDraft => ({
  name: user.name,
  username: user.username ?? '',
  email: user.email,
  phone: user.phone ?? '',
  role: user.role,
  isActive: user.isActive,
  workspaceIdsText: (user.workspaceIds ?? []).join(', '),
  notificationSound: user.notificationSettings?.sound ?? 'soft',
  browserPushEnabled: Boolean(user.notificationSettings?.browserPushEnabled),
  customSoundDataUrl: user.notificationSettings?.customSoundDataUrl ?? '',
  allowedLocations: user.allowedLocations ?? [],
  maxDiscountPercent: user.maxDiscountPercent ?? 0,
})

const parseWorkspaceIds = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index)

const buildTelecallerPlanDraft = (
  telecallerId: string,
  monthKey: string,
  plan?: TelecallerMonthlyPlanRecord | null,
): TelecallerPlanEditDraft => ({
  telecallerId,
  monthKey,
  targetAmount: plan ? String(plan.targetAmount) : '',
  incentivePercent: plan?.incentivePercent != null ? String(plan.incentivePercent) : '',
})

const getUserManagementPolicy = (
  viewerRole: Role,
  viewerUserId: string,
  user: UserRecord,
): UserManagementPolicy => {
  if (viewerRole === 'Owner') {
    const isSelf = viewerUserId === user.id
    return {
      canManage: true,
      canEditRole: !isSelf,
      canToggleStatus: !isSelf,
      canDelete: !isSelf,
      allowedRoles: roleOptions,
      summary: isSelf
        ? 'You can update your profile, workspace access, and notification preferences here. Role and status changes for your own account are blocked.'
        : 'Owner access: full editing is available for this account, including role, status, workspace access, and notification settings.',
    }
  }

  if (viewerRole === 'Admin') {
    const canManage = adminManageableRoles.includes(user.role)
    return {
      canManage,
      canEditRole: canManage,
      canToggleStatus: canManage,
      canDelete: canManage,
      allowedRoles: adminManageableRoles,
      summary: canManage
        ? 'Admin access: full editing is available for operational roles. Owner and Admin accounts remain read-only.'
        : 'This is a privileged account. Only an Owner can edit or deactivate it.',
    }
  }

  if (viewerRole === 'HR') {
    // HR can manage operational staff only — never Owner, Admin, fellow
    // HR, Accountant, or system roles. The user-edit role dropdown is
    // bound to allowedRoles, so HR physically cannot promote anyone
    // outside the staff tier.
    const canManage = hrManageableRoles.includes(user.role)
    return {
      canManage,
      canEditRole: canManage,
      canToggleStatus: canManage,
      canDelete: false, // hard rule: HR cannot delete accounts; Owner only
      allowedRoles: hrManageableRoles,
      summary: canManage
        ? 'HR access: manage scheduling, status, and role within the operational staff tier. Privileged accounts stay read-only.'
        : 'This is a privileged account. HR access is limited to operational staff (Telecaller, Cashier, TrackMarshall, Incharge, Editor).',
    }
  }

  return {
    canManage: false,
    canEditRole: false,
    canToggleStatus: false,
    canDelete: false,
    allowedRoles: [],
    summary: 'You do not have permission to manage this account.',
  }
}

const AdminModule = ({
  view,
  moduleContext = 'admin',
}: {
  view: AdminView
  /**
   * When 'incentives', re-theme the telecallers view to appear under the
   * Incentives module (breadcrumbs, title, subnav, moduleTab). Used by the
   * `/incentives/telecallers` route so the whole page feels like part of
   * Incentives without physically extracting the component.
   */
  moduleContext?: 'admin' | 'incentives'
}) => {
  const { session } = useAuth()
  const token = session?.token
  const currentUser = session?.user ?? null
  const toast = useToast()
  const navigate = useNavigate()
  const { enabledLocations } = useLocations()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<UserRecord[]>([])
  const [vendorForms, setVendorForms] = useState<VendorDetailsRecord[]>([])
  const [vendorRegistrations, setVendorRegistrations] = useState<VendorRegistrationRecord[]>([])
  const [regActionLoading, setRegActionLoading] = useState<string | null>(null)
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null)
  const [revenueShareInput, setRevenueShareInput] = useState('')
  const [vendorTypeInput, setVendorTypeInput] = useState<'ThirdParty' | 'SubLease'>('ThirdParty')
  const [pendingDeleteVendor, setPendingDeleteVendor] = useState<VendorDetailsRecord | null>(null)
  const [vendorDeleteLoading, setVendorDeleteLoading] = useState(false)
  const [editingVendorForm, setEditingVendorForm] = useState<VendorDetailsRecord | null>(null)
  const [vendorEditDraft, setVendorEditDraft] = useState<Record<string, string>>({})
  const [logs, setLogs] = useState<
    Array<{ id: string; action: string; entityType: string; createdAt: string }>
  >([])
  const [telecallerSearch, setTelecallerSearch] = useState('')
  const [debouncedTelecallerSearch, setDebouncedTelecallerSearch] = useState('')
  const [telecallerStatus, setTelecallerStatus] = useState<'Active' | 'Inactive' | ''>('')
  const [telecallerMonthKey, setTelecallerMonthKey] = useState(
    telecallerPerformanceApi.getCurrentMonthKey(),
  )
  const [telecallerMonthlyPlans, setTelecallerMonthlyPlans] = useState<
    TelecallerMonthlyPlanRecord[]
  >([])
  const [telecallerMonthlyPerformance, setTelecallerMonthlyPerformance] = useState<
    TelecallerMonthlyPerformanceRecord[]
  >([])
  const [editingTelecallerPlanUser, setEditingTelecallerPlanUser] = useState<UserRecord | null>(
    null,
  )
  const [editingTelecallerPlanDraft, setEditingTelecallerPlanDraft] =
    useState<TelecallerPlanEditDraft | null>(null)
  const [telecallerGlobalIncentivePercent, setTelecallerGlobalIncentivePercent] = useState<
    number | null
  >(null)

  const [userSearch, setUserSearch] = useState('')
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('')
  const [userStatus, setUserStatus] = useState<'Active' | 'Inactive' | ''>('')
  const [userRoleFilter, setUserRoleFilter] = useState<Role | ''>('')
  const [userLocationFilter, setUserLocationFilter] = useState<string>('')
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [createUserAllowedLocations, setCreateUserAllowedLocations] = useState<string[]>([])

  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [editDraft, setEditDraft] = useState<UserEditDraft | null>(null)

  // Customer management state — Customer 360 Phase 1 advanced search/filter/sort
  const [customers, setCustomers] = useState<AsquareCustomer[]>([])
  const [customerSearchKind, setCustomerSearchKind] = useState<'phone' | 'name' | 'email'>('name')
  const [customerSearch, setCustomerSearch] = useState('')
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('')
  const [customerTierFilter, setCustomerTierFilter] = useState('')
  const [membershipFilter, setMembershipFilter] = useState('')
  const [verifiedFilter, setVerifiedFilter] = useState<'' | 'yes' | 'no'>('')
  const [branchPreferredFilter, setBranchPreferredFilter] = useState('')
  const [spendBucketFilter, setSpendBucketFilter] = useState<'' | '0' | '1-5k' | '5-25k' | '25k+'>(
    '',
  )
  const [bookingBucketFilter, setBookingBucketFilter] = useState<'' | '0' | '1' | '2-5' | '6+'>('')
  const [hasWalletFilter, setHasWalletFilter] = useState(false)
  const [hasTiresFilter, setHasTiresFilter] = useState(false)
  const [hasCouponsFilter, setHasCouponsFilter] = useState(false)
  const [activeRangeKind, setActiveRangeKind] = useState<
    '' | 'joined' | 'lastSeen' | 'lastBooking'
  >('')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [customerSortBy, setCustomerSortBy] = useState<ListCustomersSortBy>('createdAt')
  const [customerSortDir, setCustomerSortDir] = useState<'asc' | 'desc'>('desc')
  const [cursorStack, setCursorStack] = useState<QueryDocumentSnapshot<DocumentData>[]>([])
  const [nextCursor, setNextCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<AsquareCustomer | null>(null)
  const [pendingDeleteCustomer, setPendingDeleteCustomer] = useState<AsquareCustomer | null>(null)

  // Location management state
  const [locations, setLocations] = useState<AsquareLocationWithMetrics[]>([])
  const [locationOverrides, setLocationOverrides] = useState<Record<string, boolean>>({})
  const [locationSaving, setLocationSaving] = useState(false)

  // Notification management state
  const [notifications, setNotifications] = useState<AsquareNotification[]>([])
  const [notifSearch, setNotifSearch] = useState('')
  const [debouncedNotifSearch, setDebouncedNotifSearch] = useState('')
  const [notifStatusFilter, setNotifStatusFilter] = useState<'' | 'new' | 'contacted'>('')

  // ── Customer Controls state (Owner only) ──
  const [ccPhone, setCcPhone] = useState('')
  const [ccCustomer, setCcCustomer] = useState<CustomerControlsData | null>(null)
  const [ccHistory, setCcHistory] = useState<WalletTransaction[]>([])
  const [ccLoading, setCcLoading] = useState(false)
  const [ccError, setCcError] = useState<string | null>(null)
  const [ccActionLoading, setCcActionLoading] = useState(false)
  const [ccWalletType, setCcWalletType] = useState<'credit' | 'debit'>('credit')
  const [ccWalletAmount, setCcWalletAmount] = useState('')
  const [ccWalletNote, setCcWalletNote] = useState('')
  const [ccBlacklistDialog, setCcBlacklistDialog] = useState(false)
  const [ccBlacklistReason, setCcBlacklistReason] = useState('')

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedTelecallerSearch(telecallerSearch.trim())
    }, 300)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [telecallerSearch])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedUserSearch(userSearch.trim())
    }, 300)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [userSearch])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedCustomerSearch(customerSearch.trim())
    }, 300)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [customerSearch])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedNotifSearch(notifSearch.trim())
    }, 300)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [notifSearch])

  // Server now applies all filters/sort/search; the list-view just renders
  // the page-of-customers it received. Kept as a derived alias so the JSX
  // below doesn't change shape.
  const filteredCustomers = customers

  const filteredNotifications = useMemo(() => {
    const term = debouncedNotifSearch.toLowerCase()
    return notifications.filter((n) => {
      const matchesSearch = !term || n.name.toLowerCase().includes(term) || n.phone.includes(term)
      const matchesStatus = !notifStatusFilter || n.status === notifStatusFilter
      return matchesSearch && matchesStatus
    })
  }, [notifications, debouncedNotifSearch, notifStatusFilter])

  const handleDownloadUsers = async () => {
    if (!token) return
    try {
      setLoading(true)
      const result = await usersApi.list(token)
      const allUsers = result.users

      const headers = [
        'ID',
        'Name',
        'Email',
        'Phone',
        'Username',
        'Role',
        'Status',
        'Created At',
        'Last Login',
      ]
      const rows = allUsers.map((u) =>
        [
          u.id,
          u.name,
          u.email,
          u.phone ?? '',
          u.username ?? '',
          u.role,
          u.isActive ? 'Active' : 'Inactive',
          u.createdAt ?? '',
          u.lastLoginAt ?? '',
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      )

      const blob = new Blob([[headers.join(','), ...rows].join('\n')], {
        type: 'text/csv;charset=utf-8;',
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `users_export_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      logger.error('admin_module.export_users_failed', err)
    } finally {
      setLoading(false)
    }
  }

  const load = async () => {
    if (!token) return
    setLoading(true)
    try {
      if (view === 'users') {
        const result = await usersApi.list(token, {
          status: userStatus || undefined,
          role: (userRoleFilter as Role) || undefined,
          q: debouncedUserSearch || undefined,
          location: userLocationFilter || undefined,
        })
        setUsers(result.users)
        setTelecallerMonthlyPlans([])
        setTelecallerMonthlyPerformance([])
      } else if (view === 'telecallers') {
        const [result, plansResult, performanceResult, configResult] = await Promise.all([
          usersApi.list(token, {
            role: 'Telecaller',
            status: telecallerStatus || undefined,
            q: debouncedTelecallerSearch || undefined,
          }),
          telecallerPerformanceApi.listPlans(telecallerMonthKey),
          telecallerPerformanceApi.listPerformance({ monthKey: telecallerMonthKey }),
          telecallerPerformanceApi.getGlobalConfig().catch(() => null),
        ])
        setUsers(result.users)
        setTelecallerMonthlyPlans(plansResult.plans)
        setTelecallerMonthlyPerformance(performanceResult.performance)
        setTelecallerGlobalIncentivePercent(configResult?.config?.defaultIncentivePercent ?? null)
      } else if (view === 'audit') {
        const result = await adminApi.listAuditLogs(token, 100)
        setLogs(result.logs)
        setTelecallerMonthlyPlans([])
        setTelecallerMonthlyPerformance([])
      } else if (view === 'vendors') {
        const result = await vendorDetailsApi.list(token)
        setVendorForms(result)
        setTelecallerMonthlyPlans([])
        setTelecallerMonthlyPerformance([])
      } else if (view === 'registrations') {
        const result = await vendorRegistrationApi.list(token)
        setVendorRegistrations(result)
        setTelecallerMonthlyPlans([])
        setTelecallerMonthlyPerformance([])
      } else if (view === 'customers') {
        const search = debouncedCustomerSearch
        const parseDate = (s: string): Date | undefined => {
          if (!s) return undefined
          const d = new Date(s)
          return Number.isFinite(d.getTime()) ? d : undefined
        }
        const result = await asquareCustomersApi.listCustomers({
          pageSize: 20,
          cursor: cursorStack[cursorStack.length - 1],
          sortBy: customerSortBy,
          sortDir: customerSortDir,
          filters: {
            tier: customerTierFilter || undefined,
            membership: membershipFilter || undefined,
            verified: verifiedFilter === '' ? undefined : verifiedFilter === 'yes',
            branchPreferred: branchPreferredFilter || undefined,
            spendBucket: spendBucketFilter || undefined,
            bookingBucket: bookingBucketFilter || undefined,
            hasWalletBalance: hasWalletFilter || undefined,
            hasTires: hasTiresFilter || undefined,
            hasUnredeemedCoupons150: hasCouponsFilter || undefined,
            ...(activeRangeKind === 'joined'
              ? { joinedAfter: parseDate(rangeFrom), joinedBefore: parseDate(rangeTo) }
              : {}),
            ...(activeRangeKind === 'lastSeen'
              ? { lastSeenAfter: parseDate(rangeFrom), lastSeenBefore: parseDate(rangeTo) }
              : {}),
            ...(activeRangeKind === 'lastBooking'
              ? {
                  lastBookingAfter: parseDate(rangeFrom),
                  lastBookingBefore: parseDate(rangeTo),
                }
              : {}),
          },
          search: search ? { kind: customerSearchKind, value: search } : undefined,
        })
        setCustomers(result.items)
        setNextCursor(result.nextCursor)
      } else if (view === 'locations') {
        const result = await asquareLocationsApi.listLocationsWithMetrics()
        setLocations(result)
        setLocationOverrides(Object.fromEntries(result.map((loc) => [loc.id, loc.enabled])))
      } else if (view === 'notifications') {
        const result = await asquareNotificationsApi.listNotifications()
        setNotifications(result)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load admin data.')
    } finally {
      setLoading(false)
    }
  }

  const openEditUser = (user: UserRecord) => {
    if (!currentUser) return
    const policy = getUserManagementPolicy(currentUser.role, currentUser.id, user)
    if (!policy.canManage) {
      toast.error(policy.summary)
      return
    }

    setEditingUser(user)
    setEditDraft(buildUserEditDraft(user))
  }

  const closeEditUser = () => {
    setEditingUser(null)
    setEditDraft(null)
  }

  const telecallerPlansById = new Map(
    telecallerMonthlyPlans.map((plan) => [plan.telecallerId, plan] as const),
  )
  const telecallerPerformanceById = new Map(
    telecallerMonthlyPerformance.map(
      (performance) => [performance.telecallerId, performance] as const,
    ),
  )

  const openTelecallerPlanEditor = (user: UserRecord) => {
    const existingPlan = telecallerPlansById.get(user.id) ?? null
    setEditingTelecallerPlanUser(user)
    setEditingTelecallerPlanDraft(
      buildTelecallerPlanDraft(user.id, telecallerMonthKey, existingPlan),
    )
  }

  const closeTelecallerPlanEditor = () => {
    setEditingTelecallerPlanUser(null)
    setEditingTelecallerPlanDraft(null)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    view,
    debouncedTelecallerSearch,
    telecallerStatus,
    debouncedUserSearch,
    userStatus,
    userRoleFilter,
    userLocationFilter,
    telecallerMonthKey,
    debouncedCustomerSearch,
    customerSearchKind,
    customerTierFilter,
    membershipFilter,
    verifiedFilter,
    branchPreferredFilter,
    spendBucketFilter,
    bookingBucketFilter,
    hasWalletFilter,
    hasTiresFilter,
    hasCouponsFilter,
    activeRangeKind,
    rangeFrom,
    rangeTo,
    customerSortBy,
    customerSortDir,
    cursorStack,
    debouncedNotifSearch,
    notifStatusFilter,
  ])

  // Reset pagination cursor whenever the customer query inputs change so
  // the existing cursor doesn't mismatch a freshly-shaped query. We watch
  // the IMMEDIATE search input (not the debounced one) so clicking Next
  // during the 300ms debounce window can't carry a stale cursor across
  // a query-shape change — Firestore would reject it with "you are
  // trying to start or end a query using a document for which the field
  // ... does not exist."
  useEffect(() => {
    setCursorStack([])
  }, [
    customerSearchKind,
    customerSearch,
    customerTierFilter,
    membershipFilter,
    verifiedFilter,
    branchPreferredFilter,
    spendBucketFilter,
    bookingBucketFilter,
    hasWalletFilter,
    hasTiresFilter,
    hasCouponsFilter,
    activeRangeKind,
    rangeFrom,
    rangeTo,
    customerSortBy,
    customerSortDir,
  ])

  const onCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    const form = event.currentTarget
    const formData = new FormData(form)
    const payload = {
      name: String(formData.get('name') ?? ''),
      username: String(formData.get('username') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      role: String(formData.get('role') ?? 'Telecaller') as Role,
      workspaceIds: [],
      allowedLocations: createUserAllowedLocations,
      temporaryPassword: String(formData.get('temporaryPassword') ?? ''),
    }
    setLoading(true)
    try {
      await usersApi.create(token, payload)
      toast.success('User created.')
      await load()
      form.reset()
      setCreateUserAllowedLocations([])
      setShowCreateUser(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user.')
    } finally {
      setLoading(false)
    }
  }

  const onCreateTelecaller = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    const form = event.currentTarget
    const formData = new FormData(form)
    const payload = {
      name: String(formData.get('name') ?? ''),
      username: String(formData.get('username') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      role: 'Telecaller' as const,
      workspaceIds: [],
      temporaryPassword: String(formData.get('temporaryPassword') ?? ''),
    }
    setLoading(true)
    try {
      await usersApi.create(token, payload)
      toast.success('Telecaller created.')
      await load()
      form.reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create telecaller.')
    } finally {
      setLoading(false)
    }
  }

  const onSubmitTelecallerPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!currentUser || !editingTelecallerPlanUser || !editingTelecallerPlanDraft) {
      return
    }
    if (currentUser.role !== 'Owner' && currentUser.role !== 'Admin') {
      toast.error('Only Owner or Admin can manage telecaller targets.')
      return
    }

    const targetAmount = Number(editingTelecallerPlanDraft.targetAmount)
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      toast.error('Target amount must be greater than zero.')
      return
    }

    const percentInput = editingTelecallerPlanDraft.incentivePercent.trim()
    let incentivePercent: number | null = null
    if (percentInput) {
      const parsed = Number(percentInput)
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error('Incentive percent must be a non-negative number.')
        return
      }
      incentivePercent = parsed
    }

    setLoading(true)
    try {
      await telecallerPerformanceApi.savePlan({
        telecallerId: editingTelecallerPlanUser.id,
        monthKey: editingTelecallerPlanDraft.monthKey,
        targetAmount,
        incentivePercent,
        updatedBy: currentUser.id,
      })
      toast.success(`Monthly plan saved for ${editingTelecallerPlanUser.name}.`)
      closeTelecallerPlanEditor()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save telecaller target plan.')
    } finally {
      setLoading(false)
    }
  }

  const onSetUserActiveState = async (user: UserRecord, nextActive: boolean) => {
    if (!token || !currentUser) return
    const policy = getUserManagementPolicy(currentUser.role, currentUser.id, user)
    if (!policy.canToggleStatus) {
      toast.error(policy.summary)
      return
    }

    setLoading(true)
    try {
      if (nextActive) {
        await usersApi.update(token, user.id, { isActive: true })
        toast.success('User activated.')
      } else {
        await usersApi.deactivate(token, user.id)
        toast.success('User deactivated.')
      }
      await load()
      if (editingUser?.id === user.id) {
        closeEditUser()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user status.')
    } finally {
      setLoading(false)
    }
  }

  const onSubmitEditUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token || !currentUser || !editingUser || !editDraft) return

    const policy = getUserManagementPolicy(currentUser.role, currentUser.id, editingUser)
    if (!policy.canManage) {
      toast.error(policy.summary)
      return
    }

    const nextRole = policy.canEditRole ? editDraft.role : editingUser.role
    if (!policy.allowedRoles.includes(nextRole)) {
      toast.error('Invalid role selected for this account.')
      return
    }

    if (!editDraft.name.trim() || !editDraft.username.trim() || !editDraft.email.trim()) {
      toast.error('Name, username, and email are required.')
      return
    }

    if (editDraft.notificationSound === 'custom' && !editDraft.customSoundDataUrl.trim()) {
      toast.error('Provide a custom notification sound URL or switch to a preset sound.')
      return
    }

    setLoading(true)
    try {
      await usersApi.update(token, editingUser.id, {
        name: editDraft.name.trim(),
        email: editDraft.email.trim().toLowerCase(),
        username: editDraft.username.trim(),
        phone: editDraft.phone.trim(),
        role: nextRole,
        isActive: policy.canToggleStatus ? editDraft.isActive : editingUser.isActive,
        workspaceIds: parseWorkspaceIds(editDraft.workspaceIdsText),
        allowedLocations: editDraft.allowedLocations,
        maxDiscountPercent: editDraft.maxDiscountPercent,
        notificationSettings: {
          sound: editDraft.notificationSound,
          browserPushEnabled: editDraft.browserPushEnabled,
          customSoundDataUrl:
            editDraft.notificationSound === 'custom'
              ? editDraft.customSoundDataUrl.trim() || undefined
              : undefined,
        },
      })
      toast.success('User updated.')
      await load()
      closeEditUser()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user.')
    } finally {
      setLoading(false)
    }
  }

  const onDeleteUser = async (user: UserRecord) => {
    if (!token || !currentUser) return
    const policy = getUserManagementPolicy(currentUser.role, currentUser.id, user)
    if (!policy.canDelete) {
      toast.error(policy.summary)
      return
    }
    const confirmed = window.confirm(`Deactivate user "${user.name}"?`)
    if (!confirmed) return
    await onSetUserActiveState(user, false)
  }

  const onPermanentDeleteUser = async (user: UserRecord) => {
    if (!token || !currentUser) return
    const policy = getUserManagementPolicy(currentUser.role, currentUser.id, user)
    if (!policy.canDelete) {
      toast.error(policy.summary)
      return
    }
    const confirmed = window.confirm(
      `PERMANENTLY DELETE user "${user.name}"? This action is irreversible and will remove their account entirely.`,
    )
    if (!confirmed) return

    setLoading(true)
    try {
      await usersApi.delete(token, user.id)
      toast.success('User deleted permanently.')
      await load()
      if (editingUser?.id === user.id) {
        closeEditUser()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user.')
    } finally {
      setLoading(false)
    }
  }

  const renderUserActions = (user: UserRecord) => {
    if (!currentUser) {
      return <span className="text-xs text-muted">Read-only</span>
    }

    const policy = getUserManagementPolicy(currentUser.role, currentUser.id, user)
    if (!policy.canManage) {
      return <span className="text-xs text-muted">Read-only</span>
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openEditUser(user)}
          className="ui-btn ui-btn-info min-h-8 px-2 py-1 text-xs"
        >
          Manage
        </button>
        {policy.canToggleStatus ? (
          <button
            type="button"
            onClick={() =>
              void (user.isActive ? onDeleteUser(user) : onSetUserActiveState(user, true))
            }
            className={`ui-btn min-h-8 px-2 py-1 text-xs ${user.isActive ? 'ui-btn-danger' : 'ui-btn-success'}`}
          >
            {user.isActive ? 'Deactivate' : 'Activate'}
          </button>
        ) : null}
        {policy.canDelete ? (
          <button
            type="button"
            onClick={() => void onPermanentDeleteUser(user)}
            className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
            title="Permanent Delete"
          >
            Delete
          </button>
        ) : null}
      </div>
    )
  }

  const renderTelecallerActions = (user: UserRecord) => {
    const canManagePlans = currentUser?.role === 'Owner' || currentUser?.role === 'Admin'

    return (
      <div className="flex flex-wrap items-center gap-2">
        {canManagePlans ? (
          <button
            type="button"
            onClick={() => openTelecallerPlanEditor(user)}
            className="ui-btn ui-btn-warning min-h-8 px-2 py-1 text-xs"
          >
            Target Plan
          </button>
        ) : null}
        {renderUserActions(user)}
      </div>
    )
  }

  const editingPolicy =
    currentUser && editingUser
      ? getUserManagementPolicy(currentUser.role, currentUser.id, editingUser)
      : null
  const selectedRoleDetails = editDraft
    ? roleCapabilityRows.find((row) => row.role === editDraft.role)?.capabilities
    : null

  if (!session || !token || !currentUser) {
    return null
  }
  if (
    (currentUser.role === 'Developer' || currentUser.role === 'Backend') &&
    view !== 'roles' &&
    view !== 'telecallers'
  ) {
    return <Navigate replace to="/incentives/telecallers" />
  }
  if (view === 'vendors' && currentUser.role !== 'Owner' && currentUser.role !== 'Admin') {
    return <Navigate replace to="/admin/roles" />
  }
  if (view === 'registrations' && currentUser.role !== 'Owner' && currentUser.role !== 'Admin') {
    return <Navigate replace to="/admin/roles" />
  }
  if (view === 'customer-controls' && currentUser.role !== 'Owner') {
    return <Navigate replace to="/admin/roles" />
  }

  const openApprovalDialog = (registrationId: string) => {
    setPendingApprovalId(registrationId)
    setRevenueShareInput('')
    setVendorTypeInput('ThirdParty')
  }

  const closeApprovalDialog = () => {
    setPendingApprovalId(null)
    setRevenueShareInput('')
    setVendorTypeInput('ThirdParty')
  }

  const confirmApproval = async () => {
    if (!token || !pendingApprovalId) return
    if (!revenueShareInput.trim()) {
      toast.error('Revenue Share is required. Please enter a value before approving.')
      return
    }
    const share = Number(revenueShareInput)
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      toast.error('Revenue Share must be a valid number between 0 and 100.')
      return
    }
    const registrationId = pendingApprovalId
    closeApprovalDialog()
    setRegActionLoading(registrationId)
    try {
      await vendorRegistrationApi.approve(token, registrationId, share, vendorTypeInput)
      toast.success('Vendor registration approved and account activated.')
      setVendorRegistrations((prev) =>
        prev.map((r) => (r.id === registrationId ? { ...r, status: 'Approved' } : r)),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve registration.')
    } finally {
      setRegActionLoading(null)
    }
  }

  const onRejectRegistration = async (registrationId: string) => {
    if (!token) return
    setRegActionLoading(registrationId)
    try {
      await vendorRegistrationApi.reject(token, registrationId)
      toast.success('Vendor registration rejected.')
      setVendorRegistrations((prev) =>
        prev.map((r) => (r.id === registrationId ? { ...r, status: 'Rejected' } : r)),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject registration.')
    } finally {
      setRegActionLoading(null)
    }
  }

  const confirmDeleteVendor = async () => {
    if (!token || !pendingDeleteVendor) return
    const vendor = pendingDeleteVendor
    setPendingDeleteVendor(null)
    setVendorDeleteLoading(true)
    try {
      const summary = await vendorRegistrationApi.deleteVendor(token, vendor.userId)
      setVendorForms((prev) => prev.filter((v) => v.userId !== vendor.userId))
      toast.success(
        `Vendor "${vendor.vendorName}" deleted — ` +
          `${summary.deletedBillingTransactions} transactions, ` +
          `${summary.deletedLedgerEntries} ledger entries, ` +
          `${summary.deletedVendorInvoices} invoices, ` +
          `${summary.deletedGames} game(s) removed.`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete vendor.')
    } finally {
      setVendorDeleteLoading(false)
    }
  }

  // ── Customer Controls handlers (Owner only) ──

  const handleCcLookup = async () => {
    if (!ccPhone.trim()) return
    setCcLoading(true)
    setCcError(null)
    setCcCustomer(null)
    setCcHistory([])
    try {
      const result = await lookupCustomerByPhone(ccPhone.trim())
      if (!result) {
        setCcError('No customer found with this phone number.')
        return
      }
      setCcCustomer(result)
      const history = await getCustomerWalletHistory(result.userId)
      setCcHistory(history)
    } catch (err) {
      setCcError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setCcLoading(false)
    }
  }

  const handleCcToggleLock = async () => {
    if (!ccCustomer || !currentUser) return
    const newValue = !ccCustomer.locked
    const msg = newValue ? "Lock this customer's account?" : "Unlock this customer's account?"
    if (!confirm(msg)) return
    setCcActionLoading(true)
    try {
      await toggleCustomerLock(ccCustomer.userId, newValue, {
        id: currentUser.id,
        name: currentUser.name,
      })
      setCcCustomer({ ...ccCustomer, locked: newValue })
    } catch (err) {
      setCcError(err instanceof Error ? err.message : 'Failed to toggle lock')
    } finally {
      setCcActionLoading(false)
    }
  }

  const handleCcToggleBlacklist = async (reason?: string) => {
    if (!ccCustomer) return
    const newValue = !ccCustomer.blacklisted
    if (newValue && !reason) {
      setCcBlacklistDialog(true)
      return
    }
    setCcActionLoading(true)
    setCcBlacklistDialog(false)
    try {
      await toggleCustomerBlacklist(ccCustomer.userId, newValue, reason)
      setCcCustomer({
        ...ccCustomer,
        blacklisted: newValue,
        locked: newValue ? true : ccCustomer.locked,
      })
    } catch (err) {
      setCcError(err instanceof Error ? err.message : 'Failed to toggle blacklist')
    } finally {
      setCcActionLoading(false)
    }
  }

  const handleCcToggleVerified = async () => {
    if (!ccCustomer) return
    setCcActionLoading(true)
    try {
      await toggleCustomerVerified(ccCustomer.userId, !ccCustomer.verified)
      setCcCustomer({ ...ccCustomer, verified: !ccCustomer.verified })
    } catch (err) {
      setCcError(err instanceof Error ? err.message : 'Failed to toggle verified')
    } finally {
      setCcActionLoading(false)
    }
  }

  const handleCcToggleInfluencer = async () => {
    if (!ccCustomer) return
    setCcActionLoading(true)
    try {
      await toggleCustomerInfluencer(ccCustomer.userId, !ccCustomer.influencer)
      setCcCustomer({ ...ccCustomer, influencer: !ccCustomer.influencer })
    } catch (err) {
      setCcError(err instanceof Error ? err.message : 'Failed to toggle influencer')
    } finally {
      setCcActionLoading(false)
    }
  }

  const handleCcWalletAdjust = async () => {
    if (!ccCustomer || !currentUser) return
    const amt = parseFloat(ccWalletAmount)
    if (!amt || amt <= 0 || !ccWalletNote.trim()) return

    const label = ccWalletType === 'credit' ? 'Credit' : 'Debit'
    const msg = `${label} ₹${amt} ${ccWalletType === 'credit' ? 'to' : 'from'} ${ccCustomer.displayName}'s wallet?\n\nNote: ${ccWalletNote}`
    if (!confirm(msg)) return

    setCcActionLoading(true)
    try {
      const description = `Owner adjustment: ${ccWalletNote} (by ${currentUser.name})`
      let success: boolean

      if (ccWalletType === 'credit') {
        const idempotencyKey = `ownerAdjust_${ccCustomer.userId}_${Date.now()}`
        success = await walletService.addBalance(
          ccCustomer.userId,
          amt,
          description,
          idempotencyKey,
          { ownerOverride: true },
        )
      } else {
        success = await walletService.deductBalance(ccCustomer.userId, amt, description, {
          ownerOverride: true,
        })
      }

      if (!success) throw new Error('Wallet operation returned false')

      const refreshed = await lookupCustomerByPhone(ccCustomer.phone)
      if (refreshed) setCcCustomer(refreshed)
      const history = await getCustomerWalletHistory(ccCustomer.userId)
      setCcHistory(history)
      setCcWalletAmount('')
      setCcWalletNote('')
    } catch (err) {
      setCcError(err instanceof Error ? err.message : 'Wallet adjustment failed')
    } finally {
      setCcActionLoading(false)
    }
  }

  const isIncentivesContext = moduleContext === 'incentives' && view === 'telecallers'
  const isIncentivesAdmin = currentUser.role === 'Owner' || currentUser.role === 'Admin'

  return (
    <ModulePageLayout
      moduleTab={isIncentivesContext ? 'Incentives' : 'Admin'}
      title={
        isIncentivesContext
          ? 'Telecallers'
          : `Admin ${view[0]?.toUpperCase() ?? ''}${view.slice(1)}`
      }
      subtitle={
        isIncentivesContext
          ? 'Monthly targets, achievement, and estimated incentives per telecaller.'
          : 'User governance, audit trail, and role model controls.'
      }
      breadcrumbs={
        isIncentivesContext
          ? ['Pipeline', 'Incentives', 'Telecallers']
          : ['Pipeline', 'Admin', view]
      }
      subnav={
        isIncentivesContext
          ? incentivesSubnav(isIncentivesAdmin)
          : subnav.filter(
              (item) => item.to !== '/admin/customer-controls' || currentUser?.role === 'Owner',
            )
      }
    >
      {view === 'telecallers' ? (
        <>
          <FilterBar>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={telecallerSearch}
                onChange={(event) => setTelecallerSearch(event.target.value)}
                placeholder="Name, username, email, phone"
              />
            </FilterField>
            <FilterField label="Status">
              <select
                className="ui-field min-h-10"
                value={telecallerStatus}
                onChange={(event) =>
                  setTelecallerStatus(event.target.value as 'Active' | 'Inactive' | '')
                }
              >
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </FilterField>
            <FilterField label="Performance Month">
              <input
                className="ui-field min-h-10"
                type="month"
                value={telecallerMonthKey}
                onChange={(event) =>
                  setTelecallerMonthKey(
                    telecallerPerformanceApi.normalizeMonthKey(event.target.value),
                  )
                }
              />
            </FilterField>
          </FilterBar>

          {session.user.role === 'Owner' || session.user.role === 'Admin' ? (
            <div className="mb-4">
              <DetailPanel title="Add Telecaller">
                <form
                  className="grid grid-cols-1 gap-2 md:grid-cols-6"
                  onSubmit={onCreateTelecaller}
                >
                  <input className="ui-field min-h-10" name="name" placeholder="Name" required />
                  <input
                    className="ui-field min-h-10"
                    name="username"
                    placeholder="Username"
                    required
                  />
                  <input
                    className="ui-field min-h-10"
                    name="email"
                    type="email"
                    placeholder="Email"
                    required
                  />
                  <input className="ui-field min-h-10" name="phone" placeholder="Phone" required />
                  <input
                    className="ui-field min-h-10"
                    name="temporaryPassword"
                    type="password"
                    placeholder="Temporary password"
                    required
                  />
                  <button type="submit" className="ui-btn ui-btn-primary">
                    Create
                  </button>
                </form>
              </DetailPanel>
            </div>
          ) : null}

          <DataTable
            columns={[
              { key: 'name', header: 'Name', render: (user) => user.name },
              { key: 'username', header: 'Username', render: (user) => user.username ?? '-' },
              { key: 'email', header: 'Email', render: (user) => user.email },
              { key: 'phone', header: 'Phone', render: (user) => user.phone ?? '-' },
              {
                key: 'active',
                header: 'Status',
                render: (user) => (user.isActive ? 'Active' : 'Inactive'),
              },
              {
                key: 'target',
                header: 'Target',
                render: (user) => {
                  const performance = telecallerPerformanceById.get(user.id)
                  return performance?.hasPlan ? formatCurrency(performance.targetAmount) : '-'
                },
              },
              {
                key: 'achieved',
                header: 'Achieved',
                render: (user) =>
                  formatCurrency(telecallerPerformanceById.get(user.id)?.bookedAmount ?? 0),
              },
              {
                key: 'bookings',
                header: 'Bookings',
                render: (user) => String(telecallerPerformanceById.get(user.id)?.bookingCount ?? 0),
              },
              {
                key: 'incentive',
                header: 'Estimated Incentive',
                render: (user) =>
                  formatCurrency(
                    telecallerPerformanceById.get(user.id)?.estimatedIncentiveTotal ?? 0,
                  ),
              },
              {
                key: 'lastLogin',
                header: 'Last Login',
                render: (user) => (user.lastLoginAt ? fmtDateTimeFullIST(user.lastLoginAt) : '-'),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (user) => renderTelecallerActions(user),
              },
            ]}
            rows={users}
            rowKey={(user) => user.id}
            emptyMessage={loading ? 'Loading telecallers...' : 'No telecallers found.'}
          />
        </>
      ) : null}

      {view === 'users' ? (
        <>
          <FilterBar>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Name, username, email, phone"
              />
            </FilterField>
            <FilterField label="Branch">
              <select
                className="ui-field min-h-10"
                value={userLocationFilter}
                onChange={(event) => setUserLocationFilter(event.target.value)}
              >
                <option value="">All Branches</option>
                {enabledLocations.map((loc) => (
                  <option key={loc.slug} value={loc.slug}>
                    {loc.displayName}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Role">
              <select
                className="ui-field min-h-10"
                value={userRoleFilter}
                onChange={(event) => setUserRoleFilter(event.target.value as Role | '')}
              >
                <option value="">All Roles</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Status">
              <select
                className="ui-field min-h-10"
                value={userStatus}
                onChange={(event) =>
                  setUserStatus(event.target.value as 'Active' | 'Inactive' | '')
                }
              >
                <option value="">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </FilterField>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handleDownloadUsers}
                disabled={loading}
                className="ui-btn ui-btn-success min-h-10 px-4"
              >
                {loading ? 'Exporting...' : 'Download CSV'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateUser(true)}
                className="ui-btn ui-btn-primary min-h-10 px-4"
              >
                Create User
              </button>
            </div>
          </FilterBar>

          {/* ── Create User Modal ── */}
          {showCreateUser && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 backdrop-blur-sm">
              <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-lg rounded-2xl border border-border/70 bg-panel p-6 shadow-2xl"
              >
                <h3 className="mb-4 font-display text-lg font-bold text-text">Create User</h3>
                <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={onCreateUser}>
                  {}
                  <input
                    className="ui-field min-h-10"
                    name="name"
                    placeholder="Name"
                    required
                    autoFocus
                  />
                  <input
                    className="ui-field min-h-10"
                    name="username"
                    placeholder="Username"
                    required
                  />
                  <input
                    className="ui-field min-h-10"
                    name="email"
                    type="email"
                    placeholder="Email"
                    required
                  />
                  <input className="ui-field min-h-10" name="phone" placeholder="Phone" required />
                  {(() => {
                    // Single source of truth for the Create-User role
                    // options. HR gets the operational-staff slice
                    // (hrManageableRoles); everyone else (Owner / Admin)
                    // sees the full roleOptions catalog. Keeps the
                    // Create form symmetric with the user-edit policy
                    // in getUserManagementPolicy above.
                    const isHR = session.user.role === 'HR'
                    const options = isHR ? hrManageableRoles : roleOptions
                    return (
                      <select
                        className="ui-field min-h-10"
                        name="role"
                        defaultValue="Telecaller"
                        title="Role"
                        aria-label="Role"
                      >
                        {options.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )
                  })()}
                  <input
                    className="ui-field min-h-10"
                    name="temporaryPassword"
                    type="password"
                    placeholder="Temporary password"
                    required
                  />
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-muted mb-1">
                      Location Access
                    </label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={createUserAllowedLocations.length === 0}
                          onChange={() => setCreateUserAllowedLocations([])}
                        />
                        All Locations
                      </label>
                      {enabledLocations.map((loc) => (
                        <label
                          key={loc.slug}
                          className="flex items-center gap-1 text-xs text-muted"
                        >
                          <input
                            type="checkbox"
                            checked={createUserAllowedLocations.includes(loc.slug)}
                            onChange={() => {
                              setCreateUserAllowedLocations((prev) => {
                                const has = prev.includes(loc.slug)
                                return has
                                  ? prev.filter((s) => s !== loc.slug)
                                  : [...prev, loc.slug]
                              })
                            }}
                          />
                          {loc.shortName}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateUser(false)}
                      className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-muted transition-colors hover:text-text"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="ui-btn ui-btn-primary flex-1"
                    >
                      {loading ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
          <div className="mt-4">
            <DataTable
              columns={[
                { key: 'name', header: 'Name', render: (user) => user.name },
                { key: 'username', header: 'Username', render: (user) => user.username ?? '-' },
                { key: 'email', header: 'Email', render: (user) => user.email },
                { key: 'role', header: 'Role', render: (user) => user.role },
                {
                  key: 'active',
                  header: 'Status',
                  render: (user) => (user.isActive ? 'Active' : 'Inactive'),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (user) => renderUserActions(user),
                },
              ]}
              rows={users}
              rowKey={(user) => user.id}
              emptyMessage={loading ? 'Loading users...' : 'No users found.'}
            />
          </div>
        </>
      ) : null}

      {view === 'audit' ? (
        <DataTable
          columns={[
            { key: 'action', header: 'Action', render: (log) => log.action },
            { key: 'entity', header: 'Entity', render: (log) => log.entityType },
            {
              key: 'time',
              header: 'Timestamp',
              render: (log) => fmtDateTimeFullIST(log.createdAt),
            },
          ]}
          rows={logs}
          rowKey={(log) => log.id}
          emptyMessage={loading ? 'Loading logs...' : 'No logs found.'}
        />
      ) : null}

      {view === 'roles' ? (
        <DataTable
          columns={[
            { key: 'role', header: 'Role', render: (row) => row.role },
            { key: 'capability', header: 'Capabilities', render: (row) => row.capabilities },
          ]}
          rows={roleCapabilityRows}
          rowKey={(row) => row.role}
          emptyMessage="No role data."
        />
      ) : null}

      {view === 'vendors' ? (
        <DataTable
          columns={[
            {
              key: 'vendorName',
              header: 'Vendor Name',
              render: (row) => (
                <button
                  type="button"
                  className="font-semibold text-accent hover:underline text-left"
                  onClick={() => {
                    setEditingVendorForm(row)
                    setVendorEditDraft({
                      vendorName: row.vendorName,
                      mobileNumber: row.mobileNumber,
                      email: row.email,
                      particular: row.particular,
                      preferredActivity: row.preferredActivity,
                      priceInclusiveGst: String(row.priceInclusiveGst),
                      revenueShare: String(row.revenueShare),
                      gstNumber: row.gstNumber ?? '',
                      address: row.address,
                      bankAccountNumber: row.bankAccountNumber,
                      bankName: row.bankName,
                      ifscCode: row.ifscCode,
                      branch: row.branch,
                      vendorType: row.vendorType ?? 'ThirdParty',
                      branchId: row.branchId ?? '',
                    })
                  }}
                >
                  {row.vendorName}
                </button>
              ),
            },
            { key: 'userName', header: 'Employee', render: (row) => row.userName },
            { key: 'mobileNumber', header: 'Mobile', render: (row) => row.mobileNumber },
            {
              key: 'preferredActivity',
              header: 'Activity',
              render: (row) => row.preferredActivity,
            },
            { key: 'revenueShare', header: 'Share', render: (row) => `${row.revenueShare}%` },
            {
              key: 'vendorType',
              header: 'Type',
              render: (row) => (
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${row.vendorType === 'SubLease' ? 'bg-info/15 text-info' : 'bg-accent/15 text-accent'}`}
                >
                  {row.vendorType === 'SubLease' ? 'Sub Lease' : 'Third Party'}
                </span>
              ),
            },
            {
              key: 'submittedAt',
              header: 'Submitted',
              render: (row) => fmtDateIST(row.submittedAt),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (row) => (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingVendorForm(row)
                      setVendorEditDraft({
                        vendorName: row.vendorName,
                        mobileNumber: row.mobileNumber,
                        email: row.email,
                        particular: row.particular,
                        preferredActivity: row.preferredActivity,
                        priceInclusiveGst: String(row.priceInclusiveGst),
                        revenueShare: String(row.revenueShare),
                        gstNumber: row.gstNumber ?? '',
                        address: row.address,
                        bankAccountNumber: row.bankAccountNumber,
                        bankName: row.bankName,
                        ifscCode: row.ifscCode,
                        branch: row.branch,
                        vendorType: row.vendorType ?? 'ThirdParty',
                        branchId: row.branchId ?? '',
                      })
                    }}
                    className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={vendorDeleteLoading}
                    onClick={() => setPendingDeleteVendor(row)}
                    className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              ),
            },
          ]}
          rows={vendorForms}
          rowKey={(row) => row.userId}
          emptyMessage={loading ? 'Loading vendor forms...' : 'No vendor forms submitted yet.'}
        />
      ) : null}

      {view === 'registrations' ? (
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted">Loading vendor requests...</p>
          ) : vendorRegistrations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 bg-surface/50 px-4 py-8 text-center text-sm text-muted">
              No vendor registration requests yet.
            </p>
          ) : (
            vendorRegistrations.map((reg) => {
              const isPending = reg.status === 'Pending'
              const isActing = regActionLoading === reg.id
              const branchLabel = getLocationShortName(reg.branchId)
              return (
                <div
                  key={reg.id}
                  className={`rounded-2xl border bg-panel p-5 shadow-sm transition-all ${
                    isPending
                      ? 'border-warning/30 bg-warning/5'
                      : reg.status === 'Approved'
                        ? 'border-success/30'
                        : 'border-border/50 opacity-70'
                  }`}
                >
                  {/* Header row */}
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold text-text">{reg.vendorName}</h4>
                        <span className="text-xs text-muted">·</span>
                        <span className="text-sm text-muted">{reg.companyName}</span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isPending
                              ? 'border-warning/40 bg-warning/10 text-warning'
                              : reg.status === 'Approved'
                                ? 'border-success/40 bg-success/10 text-success'
                                : 'border-critical/30 bg-critical/10 text-critical'
                          }`}
                        >
                          {reg.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        Submitted {fmtDateTimeFullIST(reg.submittedAt)}
                        {reg.reviewedBy ? ` · Reviewed by ${reg.reviewedBy}` : ''}
                      </p>
                    </div>
                    {isPending && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isActing}
                          onClick={() => openApprovalDialog(reg.id)}
                          className="ui-btn ui-btn-success min-h-9 px-4 py-1.5 text-xs disabled:opacity-60"
                        >
                          {isActing ? 'Processing...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={isActing}
                          onClick={() => void onRejectRegistration(reg.id)}
                          className="ui-btn ui-btn-danger min-h-9 px-4 py-1.5 text-xs disabled:opacity-60"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Details grid */}
                  <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { label: 'Branch', value: branchLabel },
                      { label: 'Mobile', value: reg.mobileNumber },
                      { label: 'Email', value: reg.email },
                      { label: 'GST Number', value: reg.gstNumber || '—' },
                      { label: 'Bank Account', value: reg.bankAccountNumber },
                      { label: 'Bank Name', value: reg.bankName },
                      { label: 'IFSC Code', value: reg.ifscCode },
                      { label: 'Bank Branch', value: reg.bankBranch },
                      { label: 'Address', value: reg.address },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <span className="font-semibold uppercase tracking-wider text-muted">
                          {label}:{' '}
                        </span>
                        <span className="text-text">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : null}

      {view === 'customers' ? (
        <>
          <FilterBar>
            <FilterField label="Search">
              <div className="flex gap-2">
                <select
                  title="Search field"
                  className="ui-field min-h-10 w-24"
                  value={customerSearchKind}
                  onChange={(event) =>
                    setCustomerSearchKind(event.target.value as 'phone' | 'name' | 'email')
                  }
                >
                  <option value="name">Name</option>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                </select>
                <input
                  title="Customer search"
                  className="ui-field min-h-10 flex-1"
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder={
                    customerSearchKind === 'phone'
                      ? '10-digit number'
                      : customerSearchKind === 'email'
                        ? 'starts-with…'
                        : 'name starts-with…'
                  }
                />
              </div>
            </FilterField>
            <FilterField label="Tier">
              <select
                className="ui-field min-h-10"
                value={customerTierFilter}
                onChange={(event) => setCustomerTierFilter(event.target.value)}
              >
                <option value="">All</option>
                <option value="bronze">Bronze</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="platinum">Platinum</option>
                <option value="club">Club</option>
              </select>
            </FilterField>
            <FilterField label="Membership">
              <select
                className="ui-field min-h-10"
                value={membershipFilter}
                onChange={(event) => setMembershipFilter(event.target.value)}
              >
                <option value="">All</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="platinum">Platinum</option>
              </select>
            </FilterField>
            <FilterField label="Verified">
              <select
                className="ui-field min-h-10"
                value={verifiedFilter}
                onChange={(event) => setVerifiedFilter(event.target.value as '' | 'yes' | 'no')}
              >
                <option value="">All</option>
                <option value="yes">Verified</option>
                <option value="no">Unverified</option>
              </select>
            </FilterField>
            <FilterField label="Branch (preferred)">
              <select
                className="ui-field min-h-10"
                value={branchPreferredFilter}
                onChange={(event) => setBranchPreferredFilter(event.target.value)}
              >
                <option value="">All</option>
                {enabledLocations.map((loc) => (
                  <option key={loc.slug} value={loc.slug}>
                    {loc.displayName}
                  </option>
                ))}
              </select>
            </FilterField>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="ui-btn ui-btn-neutral min-h-10 px-3 text-sm self-end"
            >
              {showAdvanced ? 'Hide advanced' : 'More filters'}
            </button>
          </FilterBar>

          {showAdvanced ? (
            <div className="mb-3 rounded-xl border border-border/60 bg-panel/40 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FilterField label="Spend bucket">
                  <select
                    className="ui-field min-h-10"
                    value={spendBucketFilter}
                    onChange={(event) =>
                      setSpendBucketFilter(
                        event.target.value as '' | '0' | '1-5k' | '5-25k' | '25k+',
                      )
                    }
                  >
                    <option value="">All</option>
                    <option value="0">No spend</option>
                    <option value="1-5k">₹1–5,000</option>
                    <option value="5-25k">₹5,000–25,000</option>
                    <option value="25k+">₹25,000+</option>
                  </select>
                </FilterField>
                <FilterField label="Booking bucket">
                  <select
                    className="ui-field min-h-10"
                    value={bookingBucketFilter}
                    onChange={(event) =>
                      setBookingBucketFilter(event.target.value as '' | '0' | '1' | '2-5' | '6+')
                    }
                  >
                    <option value="">All</option>
                    <option value="0">0 bookings</option>
                    <option value="1">1 booking</option>
                    <option value="2-5">2–5 bookings</option>
                    <option value="6+">6+ bookings</option>
                  </select>
                </FilterField>
                <FilterField label="Date range">
                  <select
                    className="ui-field min-h-10"
                    value={activeRangeKind}
                    onChange={(event) =>
                      setActiveRangeKind(
                        event.target.value as '' | 'joined' | 'lastSeen' | 'lastBooking',
                      )
                    }
                    title="Firestore allows one range filter per query — pick which date axis to filter on."
                  >
                    <option value="">No date filter</option>
                    <option value="joined">Joined</option>
                    <option value="lastSeen">Last seen</option>
                    <option value="lastBooking">Last booking</option>
                  </select>
                </FilterField>
                <FilterField label={activeRangeKind ? 'From → To' : '(pick a range first)'}>
                  <div className="flex gap-2">
                    <input
                      title="Range start date"
                      type="date"
                      disabled={!activeRangeKind}
                      className="ui-field min-h-10"
                      value={rangeFrom}
                      onChange={(event) => setRangeFrom(event.target.value)}
                    />
                    <input
                      title="Range end date"
                      type="date"
                      disabled={!activeRangeKind}
                      className="ui-field min-h-10"
                      value={rangeTo}
                      onChange={(event) => setRangeTo(event.target.value)}
                    />
                  </div>
                </FilterField>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-text">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hasWalletFilter}
                    onChange={(event) => setHasWalletFilter(event.target.checked)}
                  />
                  Has wallet balance
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hasTiresFilter}
                    onChange={(event) => setHasTiresFilter(event.target.checked)}
                  />
                  Has tire points
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hasCouponsFilter}
                    onChange={(event) => setHasCouponsFilter(event.target.checked)}
                  />
                  Has unredeemed ₹150 coupons
                </label>
              </div>
            </div>
          ) : null}

          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>Sort by</span>
            <select
              title="Sort customers by"
              className="ui-field min-h-9"
              value={customerSortBy}
              onChange={(event) => setCustomerSortBy(event.target.value as ListCustomersSortBy)}
            >
              <option value="createdAt">Joined</option>
              <option value="lastLoginAt">Last seen</option>
              <option value="lastBookingAt">Last booking</option>
              <option value="totalSpent">Total spent</option>
              <option value="bookingCount">Booking count</option>
              <option value="walletBalance">Wallet balance</option>
              <option value="tires">Tires</option>
            </select>
            <button
              type="button"
              onClick={() => setCustomerSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              className="ui-btn ui-btn-neutral min-h-9 px-3"
            >
              {customerSortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>
          </div>

          <DataTable
            columns={[
              { key: 'name', header: 'Name', render: (c) => c.displayName || '-' },
              { key: 'phone', header: 'Phone', render: (c) => c.phone || '-' },
              { key: 'email', header: 'Email', render: (c) => c.email || '-' },
              {
                key: 'tier',
                header: 'Tier',
                render: (c) => (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      c.tier.toLowerCase() === 'gold'
                        ? 'bg-warning/15 text-warning'
                        : c.tier.toLowerCase() === 'platinum'
                          ? 'bg-accent/15 text-accent'
                          : c.tier.toLowerCase() === 'silver'
                            ? 'bg-info/15 text-info'
                            : c.tier.toLowerCase() === 'club'
                              ? 'bg-success/15 text-success'
                              : 'bg-surface text-muted'
                    }`}
                  >
                    {c.tier}
                  </span>
                ),
              },
              {
                key: 'membership',
                header: 'Membership',
                render: (c) =>
                  c.membership ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        c.membership.toLowerCase() === 'gold'
                          ? 'bg-warning/15 text-warning'
                          : c.membership.toLowerCase() === 'platinum'
                            ? 'bg-accent/15 text-accent'
                            : c.membership.toLowerCase() === 'silver'
                              ? 'bg-info/15 text-info'
                              : 'bg-surface text-muted'
                      }`}
                    >
                      {c.membership}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  ),
              },
              { key: 'star', header: 'Star', render: (c) => c.starStatus || '0' },
              { key: 'visits', header: 'Visits', render: (c) => String(c.bookingCount) },
              {
                key: 'totalSpent',
                header: 'Total Spent',
                render: (c) => formatCurrency(c.totalSpent),
              },
              { key: 'tires', header: 'Tires', render: (c) => String(c.tires) },
              { key: 'wallet', header: 'Wallet', render: (c) => formatCurrency(c.walletBalance) },
              {
                key: 'couponsEarned',
                header: 'Earned',
                render: (c) => String(c.coupons150Earned),
              },
              {
                key: 'couponsRedeemed',
                header: 'Redeemed',
                render: (c) => String(c.coupons150Redeemed),
              },
              {
                key: 'couponsAvailable',
                header: 'Available',
                render: (c) => (
                  <span
                    className={
                      c.coupons150Available > 0 ? 'font-medium text-success' : 'text-muted'
                    }
                  >
                    {String(c.coupons150Available)}
                  </span>
                ),
              },
              {
                key: 'verified',
                header: 'Verified',
                render: (c) => (
                  <span className={c.isVerified ? 'text-success' : 'text-critical'}>
                    {c.isVerified ? '\u2713' : '\u2717'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (c) => (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingCustomer(c)
                      }}
                      className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingDeleteCustomer(c)
                      }}
                      className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
            rows={filteredCustomers}
            rowKey={(c) => c.id}
            emptyMessage={loading ? 'Loading customers...' : 'No customers found.'}
            onRowClick={(c) => navigate(`/admin/customers/${c.id}`)}
          />

          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              {customers.length} on this page
              {cursorStack.length > 0 ? ` · page ${cursorStack.length + 1}` : ''}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={cursorStack.length === 0}
                onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
                className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={!nextCursor}
                onClick={() => {
                  if (nextCursor) setCursorStack((stack) => [...stack, nextCursor])
                }}
                className="ui-btn ui-btn-neutral min-h-7 px-3 text-xs"
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}

      {view === 'locations' ? (
        <>
          <div className="mb-4 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
            <p className="text-sm text-text">
              For full location management with activities, staff, and more controls:
            </p>
            <Link
              to="/locations"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
            >
              Open Location Control Center →
            </Link>
          </div>
          <DataTable
            columns={[
              { key: 'name', header: 'Name', render: (loc) => loc.name },
              { key: 'bookings', header: 'Bookings', render: (loc) => String(loc.bookingCount) },
              { key: 'revenue', header: 'Revenue', render: (loc) => formatCurrency(loc.revenue) },
              {
                key: 'lastBooking',
                header: 'Last Booking',
                render: (loc) => (loc.lastBookingAt ? fmtDateIST(loc.lastBookingAt) : '\u2014'),
              },
              {
                key: 'enabled',
                header: 'Enabled',
                render: (loc) => (
                  <input
                    type="checkbox"
                    checked={locationOverrides[loc.id] ?? loc.enabled}
                    onChange={(e) =>
                      setLocationOverrides((prev) => ({ ...prev, [loc.id]: e.target.checked }))
                    }
                  />
                ),
              },
            ]}
            rows={locations}
            rowKey={(loc) => loc.id}
            emptyMessage={loading ? 'Loading locations...' : 'No locations found.'}
          />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={locationSaving}
              onClick={async () => {
                setLocationSaving(true)
                try {
                  await asquareLocationsApi.updateLocationVisibility(locationOverrides)
                  toast.success('Location visibility updated.')
                  await load()
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : 'Failed to save location visibility.',
                  )
                } finally {
                  setLocationSaving(false)
                }
              }}
              className="ui-btn ui-btn-primary min-h-10 px-4 text-sm"
            >
              {locationSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </>
      ) : null}

      {view === 'notifications' ? (
        <>
          <FilterBar>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={notifSearch}
                onChange={(event) => setNotifSearch(event.target.value)}
                placeholder="Name, phone"
              />
            </FilterField>
            <FilterField label="Status">
              <select
                className="ui-field min-h-10"
                value={notifStatusFilter}
                onChange={(event) =>
                  setNotifStatusFilter(event.target.value as '' | 'new' | 'contacted')
                }
              >
                <option value="">All</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
              </select>
            </FilterField>
          </FilterBar>

          <DataTable
            columns={[
              { key: 'type', header: 'Type', render: (n) => n.type || '-' },
              { key: 'name', header: 'Name', render: (n) => n.name || '-' },
              { key: 'phone', header: 'Phone', render: (n) => n.phone || '-' },
              { key: 'location', header: 'Location', render: (n) => n.locationName || '-' },
              {
                key: 'status',
                header: 'Status',
                render: (n) => (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      n.status === 'contacted'
                        ? 'bg-success/15 text-success'
                        : 'bg-warning/15 text-warning'
                    }`}
                  >
                    {n.status}
                  </span>
                ),
              },
              {
                key: 'date',
                header: 'Date',
                render: (n) => fmtDateIST(n.createdAt),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (n) => (
                  <div className="flex gap-1">
                    {n.status === 'new' ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await asquareNotificationsApi.markContacted(n.id)
                            toast.success('Marked as contacted.')
                            await load()
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : 'Failed to mark as contacted.',
                            )
                          }
                        }}
                        className="ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs"
                      >
                        Mark Contacted
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await asquareNotificationsApi.deleteNotification(n.id)
                          toast.success('Notification deleted.')
                          await load()
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : 'Failed to delete notification.',
                          )
                        }
                      }}
                      className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
            rows={filteredNotifications}
            rowKey={(n) => n.id}
            emptyMessage={loading ? 'Loading notifications...' : 'No notifications found.'}
          />
        </>
      ) : null}

      {view === 'customer-controls' ? (
        <div className="space-y-6">
          {/* Search */}
          <div className="flex gap-3">
            <input
              type="tel"
              placeholder="Search customer by phone..."
              value={ccPhone}
              onChange={(e) => setCcPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCcLookup()}
              className="flex-1 bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
            />
            <button
              onClick={handleCcLookup}
              disabled={ccLoading || !ccPhone.trim()}
              className="px-6 py-2.5 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ccLoading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {ccError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
              {ccError}
            </div>
          )}

          {ccCustomer && (
            <div className="space-y-6">
              {/* Customer Info */}
              <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">{ccCustomer.displayName}</h3>
                    <p className="text-dark-400 text-sm">
                      {ccCustomer.phone}
                      {ccCustomer.email && ` · ${ccCustomer.email}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-dark-400 text-xs">Wallet Balance</p>
                    <p className="text-xl font-bold text-white">
                      ₹{ccCustomer.walletBalance.toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex gap-2 flex-wrap">
                  {ccCustomer.blacklisted && (
                    <span className="px-2.5 py-1 bg-red-500/20 text-red-400 text-xs font-bold rounded-full">
                      Blacklisted
                    </span>
                  )}
                  {ccCustomer.locked && !ccCustomer.blacklisted && (
                    <span className="px-2.5 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded-full">
                      Locked
                    </span>
                  )}
                  {ccCustomer.verified && (
                    <span className="px-2.5 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded-full">
                      Verified
                    </span>
                  )}
                  {ccCustomer.influencer && (
                    <span className="px-2.5 py-1 bg-yellow-500/20 text-yellow-400 text-xs font-bold rounded-full">
                      Influencer
                    </span>
                  )}
                  {!ccCustomer.locked && !ccCustomer.blacklisted && (
                    <span className="px-2.5 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded-full">
                      Active
                    </span>
                  )}
                </div>
              </div>

              {/* Account Controls */}
              <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
                <h4 className="text-sm font-bold text-dark-300 uppercase tracking-wider mb-4">
                  Account Controls
                </h4>
                <div className="space-y-3">
                  {/* Lock Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <Lock className="w-4 h-4 text-dark-400" />
                      <span className="text-white text-sm">Lock Account</span>
                    </div>
                    <button
                      onClick={handleCcToggleLock}
                      disabled={ccActionLoading || ccCustomer.blacklisted}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        ccCustomer.locked ? 'bg-amber-500' : 'bg-dark-600'
                      } ${ccCustomer.blacklisted ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          ccCustomer.locked ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* Blacklist Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <ShieldBan className="w-4 h-4 text-dark-400" />
                      <span className="text-white text-sm">Blacklist</span>
                    </div>
                    <button
                      onClick={() => handleCcToggleBlacklist()}
                      disabled={ccActionLoading}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        ccCustomer.blacklisted ? 'bg-red-500' : 'bg-dark-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          ccCustomer.blacklisted ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* Verified Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <ShieldCheck className="w-4 h-4 text-dark-400" />
                      <span className="text-white text-sm">Verified</span>
                    </div>
                    <button
                      onClick={handleCcToggleVerified}
                      disabled={ccActionLoading}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        ccCustomer.verified ? 'bg-blue-500' : 'bg-dark-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          ccCustomer.verified ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* Influencer Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <Star className="w-4 h-4 text-dark-400" />
                      <span className="text-white text-sm">Influencer</span>
                    </div>
                    <button
                      onClick={handleCcToggleInfluencer}
                      disabled={ccActionLoading}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        ccCustomer.influencer ? 'bg-yellow-500' : 'bg-dark-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          ccCustomer.influencer ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Wallet Adjustment */}
              <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
                <h4 className="text-sm font-bold text-dark-300 uppercase tracking-wider mb-4">
                  Wallet Adjustment
                </h4>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCcWalletType('credit')}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        ccWalletType === 'credit'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-dark-700 text-dark-400'
                      }`}
                    >
                      <Plus className="w-4 h-4 inline mr-1" /> Credit
                    </button>
                    <button
                      onClick={() => setCcWalletType('debit')}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        ccWalletType === 'debit'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-dark-700 text-dark-400'
                      }`}
                    >
                      <Minus className="w-4 h-4 inline mr-1" /> Debit
                    </button>
                  </div>
                  <input
                    type="number"
                    placeholder="Amount (₹)"
                    value={ccWalletAmount}
                    onChange={(e) => setCcWalletAmount(e.target.value)}
                    min="1"
                    className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
                  />
                  <input
                    type="text"
                    placeholder="Note (required)"
                    value={ccWalletNote}
                    onChange={(e) => setCcWalletNote(e.target.value)}
                    className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-primary-500"
                  />
                  <button
                    onClick={handleCcWalletAdjust}
                    disabled={
                      ccActionLoading ||
                      !ccWalletAmount ||
                      !ccWalletNote.trim() ||
                      parseFloat(ccWalletAmount) <= 0
                    }
                    className={`w-full py-2.5 rounded-xl font-medium text-sm transition-colors ${
                      ccWalletType === 'credit'
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-red-500 hover:bg-red-600 text-white'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {ccActionLoading
                      ? 'Processing...'
                      : `${ccWalletType === 'credit' ? 'Credit' : 'Debit'} Wallet`}
                  </button>
                </div>
              </div>

              {/* Wallet History */}
              {ccHistory.length > 0 && (
                <div className="bg-dark-800/50 border border-white/10 rounded-2xl p-5">
                  <h4 className="text-sm font-bold text-dark-300 uppercase tracking-wider mb-4">
                    Recent Wallet History
                  </h4>
                  <div className="space-y-2">
                    {ccHistory.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-dark-300 truncate flex-1">{tx.description}</span>
                        <span
                          className={`font-mono font-medium ml-3 ${
                            tx.amount >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {tx.amount >= 0 ? '+' : ''}
                          {tx.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Blacklist Reason Dialog */}
          {ccBlacklistDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-base/75 backdrop-blur-sm"
                onClick={() => setCcBlacklistDialog(false)}
              />
              <div className="relative bg-dark-900 border border-white/10 rounded-2xl p-6 w-full max-w-md">
                <h3 className="text-lg font-bold text-white mb-2">Blacklist Customer</h3>
                <p className="text-dark-400 text-sm mb-4">
                  This will ban {ccCustomer?.displayName} from logging in. Enter a reason:
                </p>
                <input
                  type="text"
                  placeholder="Reason for blacklisting..."
                  value={ccBlacklistReason}
                  onChange={(e) => setCcBlacklistReason(e.target.value)}
                  className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-dark-400 focus:outline-none focus:border-red-500 mb-4"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => setCcBlacklistDialog(false)}
                    className="flex-1 py-2.5 bg-dark-700 text-dark-300 rounded-xl font-medium hover:bg-dark-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleCcToggleBlacklist(ccBlacklistReason)}
                    disabled={!ccBlacklistReason.trim()}
                    className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 disabled:opacity-50"
                  >
                    Blacklist
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Delete Vendor confirmation dialog */}
      {pendingDeleteVendor ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDeleteVendor(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-border/70 bg-panel shadow-2xl"
          >
            <div className="border-b border-border px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-critical">
                Irreversible Action
              </p>
              <h3 className="mt-1 font-display text-lg tracking-tight text-text">Delete Vendor</h3>
            </div>
            <div className="space-y-3 p-6">
              <p className="text-sm text-text">
                You are about to permanently delete{' '}
                <strong>{pendingDeleteVendor.vendorName}</strong>.
              </p>
              <p className="text-sm text-muted">
                The following data will be erased and cannot be recovered:
              </p>
              <ul className="ml-4 list-disc space-y-1 text-sm text-muted">
                <li>Vendor profile and registration record</li>
                <li>ThirdParty user account and login access</li>
                <li>All billing transactions linked to this vendor</li>
                <li>All ledger entries and vendor invoices</li>
                <li>All vendor-owned games and activity variants</li>
              </ul>
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                Company invoices are preserved as they record company-wide revenue.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setPendingDeleteVendor(null)}
                className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteVendor()}
                className="ui-btn ui-btn-danger min-h-10 px-4 text-sm"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete Customer confirmation dialog */}
      {pendingDeleteCustomer ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDeleteCustomer(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-border/70 bg-panel shadow-2xl"
          >
            <div className="border-b border-border px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-critical">
                Irreversible Action
              </p>
              <h3 className="mt-1 font-display text-lg tracking-tight text-text">
                Delete Customer
              </h3>
            </div>
            <div className="space-y-3 p-6">
              <p className="text-sm text-text">
                You are about to permanently delete{' '}
                <strong>{pendingDeleteCustomer.displayName || pendingDeleteCustomer.phone}</strong>.
              </p>
              <p className="text-sm text-muted">
                This will remove the customer record and cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setPendingDeleteCustomer(null)}
                className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = pendingDeleteCustomer.id
                  setPendingDeleteCustomer(null)
                  try {
                    await asquareCustomersApi.deleteCustomer(id)
                    toast.success('Customer deleted.')
                    await load()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to delete customer.')
                  }
                }}
                className="ui-btn ui-btn-danger min-h-10 px-4 text-sm"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Customer dialog */}
      {editingCustomer ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingCustomer(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-border/70 bg-panel shadow-2xl"
          >
            <div className="border-b border-border px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                Edit Customer
              </p>
              <h3 className="mt-1 font-display text-lg tracking-tight text-text">
                {editingCustomer.displayName || editingCustomer.phone}
              </h3>
            </div>
            <form
              className="space-y-3 p-6 max-h-[60vh] overflow-y-auto"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  const formData = new FormData(e.currentTarget)
                  // walletBalance / tires are intentionally NOT in this payload.
                  // Those are real-money fields that must go through the
                  // atomic wallet/tire services (runTransaction + freeze
                  // checks + audit log). A bare merge-setDoc would silently
                  // overwrite a live balance with whatever was in the form
                  // when the admin opened the dialog.
                  const draft = {
                    displayName: String(formData.get('displayName') ?? ''),
                    email: String(formData.get('email') ?? ''),
                    phone: String(formData.get('phone') ?? ''),
                    tier: String(formData.get('tier') ?? 'bronze'),
                    isVerified: formData.get('isVerified') === 'on',
                  }
                  await asquareCustomersApi.updateCustomer(editingCustomer.id, draft)
                  toast.success('Customer updated.')
                  setEditingCustomer(null)
                  await load()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to update customer.')
                }
              }}
            >
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Display Name
                </label>
                <input
                  className="ui-field min-h-10 w-full"
                  name="displayName"
                  type="text"
                  defaultValue={editingCustomer.displayName}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Email
                </label>
                <input
                  className="ui-field min-h-10 w-full"
                  name="email"
                  type="email"
                  defaultValue={editingCustomer.email}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Phone
                </label>
                <input
                  className="ui-field min-h-10 w-full"
                  name="phone"
                  type="text"
                  defaultValue={editingCustomer.phone}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Tier
                </label>
                <select
                  className="ui-field min-h-10 w-full"
                  name="tier"
                  defaultValue={editingCustomer.tier}
                >
                  <option value="bronze">Bronze</option>
                  <option value="silver">Silver</option>
                  <option value="gold">Gold</option>
                  <option value="platinum">Platinum</option>
                  <option value="club">Club</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Wallet Balance (read-only)
                </label>
                <input
                  className="ui-field min-h-10 w-full opacity-60 cursor-not-allowed"
                  type="number"
                  step="0.01"
                  defaultValue={editingCustomer.walletBalance}
                  disabled
                  readOnly
                  aria-describedby="wallet-readonly-hint"
                />
                <p id="wallet-readonly-hint" className="text-[10px] leading-snug text-muted">
                  Use the Wallet adjustment flow to credit / debit. Editing the balance directly
                  here would race with live bookings.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Tires (read-only)
                </label>
                <input
                  className="ui-field min-h-10 w-full opacity-60 cursor-not-allowed"
                  type="number"
                  defaultValue={editingCustomer.tires}
                  disabled
                  readOnly
                  aria-describedby="tires-readonly-hint"
                />
                <p id="tires-readonly-hint" className="text-[10px] leading-snug text-muted">
                  Adjust tires via the dedicated tire service so the audit log is written
                  atomically.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isVerified"
                  id="customer-verified"
                  defaultChecked={editingCustomer.isVerified}
                />
                <label
                  htmlFor="customer-verified"
                  className="text-xs font-semibold uppercase tracking-[0.06em] text-muted"
                >
                  Verified
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="ui-btn ui-btn-success min-h-10 px-4 text-sm">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Edit Vendor Form dialog */}
      {editingVendorForm ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingVendorForm(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-2xl rounded-xl border border-border/70 bg-panel shadow-2xl"
          >
            <div className="border-b border-border px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                Edit Vendor Details
              </p>
              <h3 className="mt-1 font-display text-lg tracking-tight text-text">
                {editingVendorForm.vendorName}
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Employee: {editingVendorForm.userName} ({editingVendorForm.userEmail}) &middot;
                Submitted {fmtDateIST(editingVendorForm.submittedAt)}
              </p>
            </div>
            <form
              className="p-6 max-h-[65vh] overflow-y-auto"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!token) return
                try {
                  await vendorDetailsApi.update(token, editingVendorForm.userId, {
                    vendorName: vendorEditDraft.vendorName,
                    mobileNumber: vendorEditDraft.mobileNumber,
                    email: vendorEditDraft.email,
                    particular: vendorEditDraft.particular,
                    preferredActivity: vendorEditDraft.preferredActivity,
                    priceInclusiveGst: Number(vendorEditDraft.priceInclusiveGst || 0),
                    revenueShare: Number(vendorEditDraft.revenueShare),
                    gstNumber: vendorEditDraft.gstNumber?.trim().toUpperCase() || '',
                    address: vendorEditDraft.address,
                    bankAccountNumber: vendorEditDraft.bankAccountNumber,
                    bankName: vendorEditDraft.bankName,
                    ifscCode: vendorEditDraft.ifscCode,
                    branch: vendorEditDraft.branch,
                    vendorType: vendorEditDraft.vendorType as 'ThirdParty' | 'SubLease' | undefined,
                    branchId: vendorEditDraft.branchId || undefined,
                  })
                  toast.success('Vendor details updated.')
                  setEditingVendorForm(null)
                  const result = await vendorDetailsApi.list(token)
                  setVendorForms(result)
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : 'Failed to update vendor details.',
                  )
                }
              }}
            >
              {/* Vendor Info */}
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                Vendor Information
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ['vendorName', 'Vendor Name'],
                    ['mobileNumber', 'Mobile Number'],
                    ['email', 'Email'],
                    ['particular', 'Particular'],
                    ['preferredActivity', 'Preferred Activity'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      {label}
                    </label>
                    <input
                      className="ui-field min-h-10 w-full"
                      value={vendorEditDraft[key] ?? ''}
                      onChange={(e) =>
                        setVendorEditDraft((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      required
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                    Vendor Type
                  </label>
                  <select
                    className="ui-field min-h-10 w-full"
                    value={vendorEditDraft.vendorType ?? 'ThirdParty'}
                    onChange={(e) =>
                      setVendorEditDraft((prev) => ({ ...prev, vendorType: e.target.value }))
                    }
                  >
                    <option value="ThirdParty">Third Party</option>
                    <option value="SubLease">Sub Lease</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                    Location
                  </label>
                  <select
                    className="ui-field min-h-10 w-full"
                    value={vendorEditDraft.branchId ?? ''}
                    onChange={(e) =>
                      setVendorEditDraft((prev) => ({ ...prev, branchId: e.target.value }))
                    }
                  >
                    <option value="">— Not assigned —</option>
                    {enabledLocations.map((loc) => (
                      <option key={loc.slug} value={loc.slug}>
                        {loc.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                    GST Number{' '}
                    <span className="font-normal normal-case text-muted">(Optional)</span>
                  </label>
                  <input
                    className="ui-field min-h-10 w-full"
                    value={vendorEditDraft.gstNumber ?? ''}
                    onChange={(e) =>
                      setVendorEditDraft((prev) => ({
                        ...prev,
                        gstNumber: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Not Provided"
                  />
                </div>
              </div>

              {/* Pricing */}
              <p className="mb-3 mt-5 text-xs font-bold uppercase tracking-wider text-muted">
                Pricing & Revenue
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                    Revenue Share (%)
                  </label>
                  <input
                    className="ui-field min-h-10 w-full"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={vendorEditDraft.revenueShare ?? ''}
                    onChange={(e) =>
                      setVendorEditDraft((prev) => ({ ...prev, revenueShare: e.target.value }))
                    }
                    required
                  />
                </div>
              </div>

              {/* Address */}
              <p className="mb-3 mt-5 text-xs font-bold uppercase tracking-wider text-muted">
                Address
              </p>
              <div className="space-y-1">
                <input
                  className="ui-field min-h-10 w-full"
                  value={vendorEditDraft.address ?? ''}
                  onChange={(e) =>
                    setVendorEditDraft((prev) => ({ ...prev, address: e.target.value }))
                  }
                  required
                />
              </div>

              {/* Bank Details */}
              <p className="mb-3 mt-5 text-xs font-bold uppercase tracking-wider text-muted">
                Bank Details
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ['bankAccountNumber', 'Bank Account Number'],
                    ['bankName', 'Bank Name'],
                    ['ifscCode', 'IFSC Code'],
                    ['branch', 'Branch'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      {label}
                    </label>
                    <input
                      className="ui-field min-h-10 w-full"
                      value={vendorEditDraft[key] ?? ''}
                      onChange={(e) =>
                        setVendorEditDraft((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      required
                    />
                  </div>
                ))}
              </div>
            </form>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setEditingVendorForm(null)}
                className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const form = document.querySelector(
                    '[role=dialog] form',
                  ) as HTMLFormElement | null
                  form?.requestSubmit()
                }}
                className="ui-btn ui-btn-success min-h-10 px-4 text-sm"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Revenue Share approval dialog */}
      {pendingApprovalId ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeApprovalDialog()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-border/70 bg-panel shadow-2xl"
          >
            <div className="border-b border-border px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                Approve Vendor
              </p>
              <h3 className="mt-1 font-display text-lg tracking-tight text-text">Revenue Share</h3>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm text-muted">
                Select vendor type and enter revenue share before approving.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Vendor Type
                </label>
                <div className="flex gap-4 text-sm text-text">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="vendorType"
                      value="ThirdParty"
                      checked={vendorTypeInput === 'ThirdParty'}
                      onChange={() => setVendorTypeInput('ThirdParty')}
                    />
                    Third Party
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="vendorType"
                      value="SubLease"
                      checked={vendorTypeInput === 'SubLease'}
                      onChange={() => setVendorTypeInput('SubLease')}
                    />
                    Sub Lease
                  </label>
                </div>
                <p className="text-[10px] text-muted">
                  {vendorTypeInput === 'ThirdParty'
                    ? 'Base + GST split proportionally'
                    : 'Vendor gets flat share of total (GST inclusive)'}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Revenue Share (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={revenueShareInput}
                  onChange={(e) => setRevenueShareInput(e.target.value)}
                  placeholder="e.g. 15"
                  className="ui-field min-h-11 w-full"
                  required
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus revenue share input on approval modal open
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmApproval()
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={closeApprovalDialog}
                className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmApproval()}
                className="ui-btn ui-btn-success min-h-10 px-4 text-sm"
              >
                Confirm &amp; Approve
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingTelecallerPlanUser && editingTelecallerPlanDraft ? (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-base/75 p-4 backdrop-blur-sm">
          <div className="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center py-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="telecaller-plan-title"
              className="w-full rounded-2xl border border-border/80 bg-panel shadow-panel"
            >
              <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h4 id="telecaller-plan-title" className="text-2xl font-semibold text-text">
                    Monthly Target Plan
                  </h4>
                  <p className="text-sm text-muted">
                    Set the target amount and incentive percentage for{' '}
                    {editingTelecallerPlanUser.name} in {editingTelecallerPlanDraft.monthKey}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeTelecallerPlanEditor}
                  className="ui-btn ui-btn-neutral min-h-9 self-start px-3 py-1.5 text-sm"
                >
                  Close
                </button>
              </div>

              <form onSubmit={onSubmitTelecallerPlan} className="space-y-5 px-5 py-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      className="mb-1 block text-sm text-muted"
                      htmlFor="telecaller-plan-month"
                    >
                      Month
                    </label>
                    <input
                      id="telecaller-plan-month"
                      className="ui-field w-full"
                      type="month"
                      value={editingTelecallerPlanDraft.monthKey}
                      disabled
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1 block text-sm text-muted"
                      htmlFor="telecaller-plan-target"
                    >
                      Target Amount
                    </label>
                    <input
                      id="telecaller-plan-target"
                      className="ui-field w-full"
                      type="number"
                      min={1}
                      step="0.01"
                      value={editingTelecallerPlanDraft.targetAmount}
                      onChange={(event) =>
                        setEditingTelecallerPlanDraft((current) =>
                          current ? { ...current, targetAmount: event.target.value } : current,
                        )
                      }
                      placeholder="50000"
                      required
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-surface/40 p-4">
                  <div>
                    <h5 className="text-lg font-semibold text-text">Incentive Percentage</h5>
                    <p className="text-sm text-muted">
                      Paid as a flat percentage of every completed booking's final amount. Leave
                      blank to use the global default
                      {telecallerGlobalIncentivePercent != null
                        ? ` (${telecallerGlobalIncentivePercent}%)`
                        : ''}
                      .
                    </p>
                  </div>
                  <div className="mt-3 max-w-xs">
                    <label
                      className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted"
                      htmlFor="telecaller-plan-percent"
                    >
                      Incentive %
                    </label>
                    <input
                      id="telecaller-plan-percent"
                      className="ui-field w-full"
                      type="number"
                      min={0}
                      step="0.01"
                      value={editingTelecallerPlanDraft.incentivePercent}
                      onChange={(event) =>
                        setEditingTelecallerPlanDraft((current) =>
                          current ? { ...current, incentivePercent: event.target.value } : current,
                        )
                      }
                      placeholder={
                        telecallerGlobalIncentivePercent != null
                          ? String(telecallerGlobalIncentivePercent)
                          : 'e.g. 2'
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
                  <button
                    type="button"
                    onClick={closeTelecallerPlanEditor}
                    className="ui-btn ui-btn-neutral min-h-10"
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ui-btn ui-btn-primary min-h-10"
                    disabled={loading}
                  >
                    {loading ? 'Saving...' : 'Save Target Plan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {editingUser && editDraft && editingPolicy ? (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-base/75 p-4 backdrop-blur-sm">
          <div className="mx-auto flex min-h-full w-full max-w-4xl items-center justify-center py-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="manage-user-title"
              className="w-full rounded-2xl border border-border/80 bg-panel shadow-panel"
            >
              <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h4 id="manage-user-title" className="text-2xl font-semibold text-text">
                    Manage User Access
                  </h4>
                  <p className="text-sm text-muted">
                    Update profile details, permissions, workspace access, and notification
                    preferences for {editingUser.name}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditUser}
                  className="ui-btn ui-btn-neutral min-h-9 self-start px-3 py-1.5 text-sm"
                >
                  Close
                </button>
              </div>

              <form onSubmit={onSubmitEditUser} className="space-y-5 px-5 py-4">
                <div className="grid gap-3 rounded-2xl border border-info/25 bg-info/5 p-4 md:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">User ID</p>
                    <p className="mt-1 text-sm font-medium text-text">{editingUser.id}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Current Status</p>
                    <p className="mt-1 text-sm font-medium text-text">
                      {editingUser.isActive ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Last Login</p>
                    <p className="mt-1 text-sm font-medium text-text">
                      {editingUser.lastLoginAt
                        ? fmtDateTimeFullIST(editingUser.lastLoginAt)
                        : 'No login recorded'}
                    </p>
                  </div>
                  <div className="md:col-span-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Access Policy</p>
                    <p className="mt-1 text-sm text-text">{editingPolicy.summary}</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-name">
                      Full Name
                    </label>
                    <input
                      id="edit-user-name"
                      className="ui-field w-full"
                      value={editDraft.name}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current ? { ...current, name: event.target.value } : current,
                        )
                      }
                      placeholder="Full name"
                      disabled={loading}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-username">
                      Username
                    </label>
                    <input
                      id="edit-user-username"
                      className="ui-field w-full"
                      value={editDraft.username}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current ? { ...current, username: event.target.value } : current,
                        )
                      }
                      placeholder="Username"
                      autoCapitalize="none"
                      disabled={loading}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-email">
                      Email
                    </label>
                    <input
                      id="edit-user-email"
                      type="email"
                      className="ui-field w-full"
                      value={editDraft.email}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current ? { ...current, email: event.target.value } : current,
                        )
                      }
                      placeholder="user@example.com"
                      autoCapitalize="none"
                      disabled={loading}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-phone">
                      Phone
                    </label>
                    <input
                      id="edit-user-phone"
                      className="ui-field w-full"
                      value={editDraft.phone}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current ? { ...current, phone: event.target.value } : current,
                        )
                      }
                      placeholder="Phone number"
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-role">
                      Role
                    </label>
                    <select
                      id="edit-user-role"
                      className="ui-field w-full"
                      value={editDraft.role}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current ? { ...current, role: event.target.value as Role } : current,
                        )
                      }
                      disabled={loading || !editingPolicy.canEditRole}
                    >
                      {editingPolicy.allowedRoles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted">
                      {editingPolicy.canEditRole
                        ? (selectedRoleDetails ??
                          "Choose the role that matches the user's operational scope.")
                        : 'Role changes are restricted for this account.'}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-muted mb-1">
                      Location Access
                    </label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={editDraft.allowedLocations.length === 0}
                          onChange={() =>
                            setEditDraft((current) =>
                              current ? { ...current, allowedLocations: [] } : current,
                            )
                          }
                          disabled={loading}
                        />
                        All Locations
                      </label>
                      {enabledLocations.map((loc) => (
                        <label
                          key={loc.slug}
                          className="flex items-center gap-1 text-xs text-muted"
                        >
                          <input
                            type="checkbox"
                            checked={editDraft.allowedLocations.includes(loc.slug)}
                            onChange={() => {
                              setEditDraft((current) => {
                                if (!current) return current
                                const has = current.allowedLocations.includes(loc.slug)
                                const next = has
                                  ? current.allowedLocations.filter((s) => s !== loc.slug)
                                  : [...current.allowedLocations, loc.slug]
                                return { ...current, allowedLocations: next }
                              })
                            }}
                            disabled={loading}
                          />
                          {loc.shortName}
                        </label>
                      ))}
                    </div>
                  </div>
                  {session?.user.role === 'Owner' && editDraft.role !== 'Owner' && (
                    <div>
                      <label
                        className="mb-1 block text-sm text-muted"
                        htmlFor="edit-user-max-discount"
                      >
                        Max Discount %
                      </label>
                      <select
                        id="edit-user-max-discount"
                        className="ui-field w-full"
                        value={editDraft.maxDiscountPercent}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current
                              ? { ...current, maxDiscountPercent: Number(event.target.value) }
                              : current,
                          )
                        }
                        disabled={loading}
                      >
                        <option value={0}>No Discount</option>
                        {[
                          5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
                        ].map((p) => (
                          <option key={p} value={p}>
                            {p}%
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-status">
                      Account Status
                    </label>
                    <select
                      id="edit-user-status"
                      className="ui-field w-full"
                      value={editDraft.isActive ? 'active' : 'inactive'}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current
                            ? { ...current, isActive: event.target.value === 'active' }
                            : current,
                        )
                      }
                      disabled={loading || !editingPolicy.canToggleStatus}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <p className="mt-1 text-xs text-muted">
                      {editingPolicy.canToggleStatus
                        ? 'Inactive users keep their record but cannot sign in.'
                        : 'Status changes are restricted for this account.'}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-workspaces">
                    Workspace Access
                  </label>
                  <input
                    id="edit-user-workspaces"
                    className="ui-field w-full"
                    value={editDraft.workspaceIdsText}
                    onChange={(event) =>
                      setEditDraft((current) =>
                        current ? { ...current, workspaceIdsText: event.target.value } : current,
                      )
                    }
                    placeholder="Comma-separated workspace IDs"
                    disabled={loading}
                  />
                  <p className="mt-1 text-xs text-muted">
                    Use workspace document IDs. Duplicate values are removed when the update is
                    saved.
                  </p>
                </div>

                <div className="grid gap-4 rounded-2xl border border-border/70 bg-surface/40 p-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-muted" htmlFor="edit-user-sound">
                      Notification Sound
                    </label>
                    <select
                      id="edit-user-sound"
                      className="ui-field w-full"
                      value={editDraft.notificationSound}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                notificationSound: event.target.value as NotificationSound,
                              }
                            : current,
                        )
                      }
                      disabled={loading}
                    >
                      {notificationSoundOptions.map((sound) => (
                        <option key={sound} value={sound}>
                          {sound === 'off'
                            ? 'Off'
                            : sound === 'custom'
                              ? 'Custom URL'
                              : sound[0].toUpperCase() + sound.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center rounded-xl border border-border/70 bg-panel px-3 py-2">
                    <label className="flex items-center gap-3 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={editDraft.browserPushEnabled}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current
                              ? { ...current, browserPushEnabled: event.target.checked }
                              : current,
                          )
                        }
                        disabled={loading}
                      />
                      Enable browser push notifications
                    </label>
                  </div>
                  {editDraft.notificationSound === 'custom' ? (
                    <div className="md:col-span-2">
                      <label
                        className="mb-1 block text-sm text-muted"
                        htmlFor="edit-user-custom-sound"
                      >
                        Custom Sound URL
                      </label>
                      <input
                        id="edit-user-custom-sound"
                        className="ui-field w-full"
                        value={editDraft.customSoundDataUrl}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current
                              ? { ...current, customSoundDataUrl: event.target.value }
                              : current,
                          )
                        }
                        placeholder="https://example.com/notification.mp3 or data:audio/..."
                        disabled={loading}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-muted">
                    {editingPolicy.canDelete
                      ? 'You can update this account or change its active status from here.'
                      : 'Only an Owner can deactivate or re-role this account.'}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {editingPolicy.canToggleStatus ? (
                      <button
                        type="button"
                        onClick={() =>
                          void (editingUser.isActive
                            ? onDeleteUser(editingUser)
                            : onSetUserActiveState(editingUser, true))
                        }
                        disabled={loading}
                        className={`ui-btn min-h-10 ${editingUser.isActive ? 'ui-btn-danger' : 'ui-btn-success'} disabled:opacity-70`}
                      >
                        {editingUser.isActive ? 'Deactivate User' : 'Activate User'}
                      </button>
                    ) : null}
                    {editingPolicy.canDelete ? (
                      <button
                        type="button"
                        onClick={() => void onPermanentDeleteUser(editingUser)}
                        disabled={loading}
                        className="ui-btn ui-btn-danger min-h-10 disabled:opacity-70"
                      >
                        Delete Permanently
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={closeEditUser}
                      className="ui-btn ui-btn-neutral min-h-10"
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ui-btn ui-btn-primary min-h-10 disabled:opacity-70"
                      disabled={loading}
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </ModulePageLayout>
  )
}

export default AdminModule
