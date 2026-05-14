import { ModuleTab, Role, RoleTabPermission } from '../../api/types'

export interface ModuleTabDefinition {
  id: ModuleTab
  label: string
  path: string
}

export const moduleTabs: ModuleTabDefinition[] = [
  { id: 'Dashboard', label: 'Dashboard', path: '/dashboard' },
  { id: 'Shifts', label: 'Shifts', path: '/shifts/my' },
  { id: 'Billing', label: 'Billing', path: '/billing/pos' },
  { id: 'Bookings', label: 'Bookings', path: '/bookings/create' },
  { id: 'Helicopter', label: 'Helicopter', path: '/helicopter/dashboard' },
  { id: 'Activities', label: 'Activities', path: '/activities/list' },
  { id: 'Track', label: 'Track', path: '/track/board' },
  { id: 'Incharge', label: 'Incharge', path: '/incharge/tasks' },
  { id: 'Workspaces', label: 'Workspaces', path: '/workspaces' },
  { id: 'Files', label: 'Files', path: '/files/library' },
  { id: 'Reports', label: 'Reports', path: '/reports/daily' },
  { id: 'Tickets', label: 'Tickets', path: '/tickets' },
  { id: 'Admin', label: 'Admin', path: '/admin/users' },
  { id: 'Accounting', label: 'Accounting', path: '/accounting/ledger' },
  { id: 'GameRevenue', label: 'Game Revenue', path: '/game-revenue' },
  { id: 'Coupons', label: 'Coupons', path: '/coupons/list' },
  { id: 'CouponOutreach', label: 'Coupon Outreach', path: '/coupon-outreach/inbox' },
  { id: 'Leads', label: 'Leads', path: '/leads/pipeline' },
  { id: 'Locations', label: 'Locations', path: '/locations' },
  { id: 'Kartfluencer', label: 'Kartfluencer', path: '/kartfluencer/list' },
  { id: 'Banners', label: 'Banners', path: '/banners/list' },
  { id: 'Incentives', label: 'Incentives', path: '/incentives/dashboard' },
  { id: 'EventCampaigns', label: 'Event Campaigns', path: '/event-campaigns/manage' },
  { id: 'Reconciliation', label: 'Reconciliation', path: '/reconciliation/orphans' },
  { id: 'Monitor', label: 'Monitor', path: '/monitor' },
  { id: 'Grievances', label: 'Messages', path: '/grievances' },
  { id: 'Employees', label: 'Employees', path: '/hr/employees' },
  { id: 'HRDocs', label: 'HR Documents', path: '/hr/documents' },
  { id: 'HRCalendar', label: 'Calendar', path: '/hr/calendar' },
  { id: 'Appraisals', label: 'Appraisals', path: '/hr/appraisals' },
  { id: 'Payroll', label: 'Payroll', path: '/hr/payroll' },
  { id: 'KartMonitor', label: 'Kart Monitor', path: '/hr/kart-monitor' },
  { id: 'Settings', label: 'Settings', path: '/settings/profile' },
]

export const roleTabPermissions: RoleTabPermission[] = [
  {
    role: 'Owner',
    tabs: [
      'Dashboard',
      'Shifts',
      'Billing',
      'Bookings',
      'Helicopter',
      'Activities',
      'Track',
      'Incharge',
      'Workspaces',
      'Tasks',
      'Files',
      'Reports',
      'Tickets',
      'Admin',
      'Accounting',
      'GameRevenue',
      'Coupons',
      'CouponOutreach',
      'Leads',
      'Locations',
      'Kartfluencer',
      'Banners',
      'Incentives',
      'EventCampaigns',
      'Reconciliation',
      'Monitor',
      'Grievances',
      'Employees',
      'HRDocs',
      'HRCalendar',
      'Appraisals',
      'Payroll',
      'KartMonitor',
      'Settings',
    ],
  },
  {
    role: 'Admin',
    tabs: [
      'Dashboard',
      'Shifts',
      'Billing',
      'Bookings',
      'Helicopter',
      'Activities',
      'Track',
      'Incharge',
      'Workspaces',
      'Tasks',
      'Files',
      'Reports',
      'Tickets',
      'Admin',
      'Accounting',
      'GameRevenue',
      'Coupons',
      'CouponOutreach',
      'Leads',
      'Locations',
      'Kartfluencer',
      'Banners',
      'Incentives',
      'EventCampaigns',
      'Reconciliation',
      'Monitor',
      'Grievances',
      'Employees',
      'HRDocs',
      'HRCalendar',
      'Appraisals',
      'Payroll',
      'KartMonitor',
      'Settings',
    ],
  },
  {
    role: 'Telecaller',
    tabs: [
      'Dashboard',
      'Shifts',
      'Bookings',
      'Activities',
      'Workspaces',
      'Tasks',
      'Tickets',
      'Leads',
      'CouponOutreach',
      'Grievances',
      'Settings',
    ],
  },
  {
    role: 'Cashier',
    tabs: [
      'Dashboard',
      'Billing',
      'Helicopter',
      'Activities',
      'Shifts',
      'Workspaces',
      'Tasks',
      'Tickets',
      'Incentives',
      'Grievances',
      'Settings',
    ],
  },
  {
    role: 'TrackMarshall',
    tabs: [
      'Dashboard',
      'Track',
      'Workspaces',
      'Tasks',
      'Tickets',
      'Kartfluencer',
      'Grievances',
      'Settings',
    ],
  },
  {
    role: 'Incharge',
    tabs: [
      'Dashboard',
      'Incharge',
      'Helicopter',
      'Shifts',
      'Workspaces',
      'Tasks',
      'Tickets',
      'Grievances',
      'Settings',
    ],
  },
  {
    role: 'Editor',
    tabs: [
      'Dashboard',
      'Shifts',
      'Workspaces',
      'Tasks',
      'Tickets',
      'Files',
      'Banners',
      'Grievances',
      'Settings',
    ],
  },
  {
    role: 'Developer',
    tabs: [
      'Dashboard',
      'Shifts',
      'Billing',
      'Bookings',
      'Helicopter',
      'Activities',
      'Track',
      'Incharge',
      'Workspaces',
      'Tasks',
      'Reports',
      'Tickets',
      'Admin',
      'Coupons',
      'Leads',
      'Locations',
      'Kartfluencer',
      'Banners',
      'Grievances',
      'Settings',
    ],
  },
  {
    role: 'Backend',
    tabs: [
      'Dashboard',
      'Billing',
      'Bookings',
      'Helicopter',
      'Activities',
      'Track',
      'Reports',
      'Tickets',
      'Admin',
      'Leads',
      'Kartfluencer',
      'Grievances',
      'Settings',
    ],
  },
  {
    role: 'ThirdParty',
    tabs: [
      'Dashboard',
      'Bookings',
      'Activities',
      'Accounting',
      'GameRevenue',
      'Coupons',
      'Grievances',
      'Settings',
    ],
  },
  {
    // HR — workforce management. Sees everything staff-related; no
    // bookings/billing/finance modules. Mirrors industry patterns
    // (BambooHR / Zoho People): attendance + shifts + leave + payroll
    // dashboards. Admin tab kept so HR can do scoped user provisioning
    // (non-admin roles); fine-grained "staff only" enforcement lives
    // inside AdminModule itself.
    role: 'HR',
    tabs: [
      'Dashboard',
      'Employees',
      'Shifts',
      'HRCalendar',
      'HRDocs',
      'Appraisals',
      'Payroll',
      'Monitor',
      'KartMonitor',
      'Incentives',
      'Incharge',
      'Workspaces',
      'Reports',
      'Files',
      'Admin',
      'Grievances',
      'Settings',
    ],
  },
  {
    // Accountant — financial bookkeeping. Read-only on Bookings per
    // segregation-of-duties: the person who creates transactions
    // shouldn't be the same one who reconciles. Primary edits land in
    // Accounting; Reports + GameRevenue are the financial-analytics
    // surfaces. Trimmed to the 6 tabs Owner specified.
    role: 'Accountant',
    tabs: ['Dashboard', 'Bookings', 'Reports', 'Accounting', 'GameRevenue', 'Settings'],
  },
]

const permissionMap = roleTabPermissions.reduce<Record<Role, ModuleTab[]>>(
  (accumulator, entry) => {
    accumulator[entry.role] = entry.tabs
    return accumulator
  },
  {} as Record<Role, ModuleTab[]>,
)

const resolveTabPath = (role: Role, tab: ModuleTabDefinition): string => {
  if (tab.id === 'Shifts' && (role === 'Owner' || role === 'Admin' || role === 'Developer')) {
    return '/shifts/team'
  }
  if (tab.id === 'Shifts' && role === 'Editor') {
    return '/shifts/leave'
  }

  if (tab.id === 'Leads' && role === 'Telecaller') {
    return '/leads/inbox'
  }

  if (tab.id === 'Kartfluencer' && role === 'TrackMarshall') {
    return '/kartfluencer/scanner'
  }

  if (tab.id === 'Helicopter') {
    if (role === 'Cashier') return '/helicopter/pricing'
    if (role === 'Incharge') return '/helicopter/manifest'
  }

  if (role !== 'Developer' && role !== 'Backend' && role !== 'ThirdParty') {
    return tab.path
  }

  if (tab.id === 'Billing') {
    return '/billing/transactions'
  }
  if (tab.id === 'Track') {
    return '/track/board'
  }
  if (tab.id === 'Admin') {
    return '/admin/roles'
  }

  return tab.path
}

export const getTabsForRole = (role: Role): ModuleTabDefinition[] =>
  moduleTabs
    .filter((tab) => permissionMap[role]?.includes(tab.id))
    .map((tab) => ({
      ...tab,
      path: resolveTabPath(role, tab),
    }))

export const canRoleAccessTab = (role: Role, tab: ModuleTab): boolean =>
  permissionMap[role]?.includes(tab) ?? false

export const getTabForPath = (pathname: string): ModuleTab => {
  if (pathname.startsWith('/dashboard')) return 'Dashboard'
  if (pathname.startsWith('/shifts')) return 'Shifts'
  if (pathname.startsWith('/billing')) return 'Billing'
  if (pathname.startsWith('/bookings')) return 'Bookings'
  if (pathname.startsWith('/helicopter')) return 'Helicopter'
  if (pathname.startsWith('/activities')) return 'Activities'
  if (pathname.startsWith('/track')) return 'Track'
  if (pathname.startsWith('/incharge')) return 'Incharge'
  if (pathname.startsWith('/workspaces')) return 'Workspaces'
  if (pathname.startsWith('/tasks')) return 'Tasks'
  if (pathname.startsWith('/files')) return 'Files'
  if (pathname.startsWith('/tickets')) return 'Tickets'
  if (pathname.startsWith('/reports')) return 'Reports'
  if (pathname.startsWith('/admin')) return 'Admin'
  if (pathname.startsWith('/locations')) return 'Locations'
  if (pathname.startsWith('/accounting')) return 'Accounting'
  if (pathname.startsWith('/game-revenue')) return 'GameRevenue'
  if (pathname.startsWith('/coupons')) return 'Coupons'
  if (pathname.startsWith('/coupon-outreach')) return 'CouponOutreach'
  if (pathname.startsWith('/leads')) return 'Leads'
  if (pathname.startsWith('/kartfluencer')) return 'Kartfluencer'
  if (pathname.startsWith('/banners')) return 'Banners'
  if (pathname.startsWith('/incentives')) return 'Incentives'
  if (pathname.startsWith('/event-campaigns')) return 'EventCampaigns'
  if (pathname.startsWith('/monitor')) return 'Monitor'
  if (pathname.startsWith('/grievances')) return 'Grievances'
  if (pathname.startsWith('/hr/employees')) return 'Employees'
  if (pathname.startsWith('/hr/documents')) return 'HRDocs'
  if (pathname.startsWith('/hr/calendar')) return 'HRCalendar'
  if (pathname.startsWith('/hr/appraisals')) return 'Appraisals'
  if (pathname.startsWith('/hr/payroll')) return 'Payroll'
  if (pathname.startsWith('/hr/kart-monitor')) return 'KartMonitor'
  return 'Settings'
}
