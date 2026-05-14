import { useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { MONITOR_VIEWER_ROLES } from '../../api/types'
import { LiveRosterSection } from './monitor/LiveRosterSection'
import { SessionHistorySection } from './monitor/SessionHistorySection'
import { useMonitorData } from '../../features/monitor/useMonitorData'

const MonitorModule = () => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()

  const allowedBranchIds = useMemo(
    () => enabledLocations.map((l) => l.branchId),
    [enabledLocations],
  )

  const data = useMonitorData(session?.token ?? '')

  // Page is Owner/Admin only — page guard (nav manifest also hides the tab).
  if (
    !session ||
    !MONITOR_VIEWER_ROLES.includes(session.user.role as (typeof MONITOR_VIEWER_ROLES)[number])
  ) {
    return <Navigate replace to="/dashboard" />
  }

  return (
    <ModulePageLayout
      moduleTab="Monitor"
      title="Staff Monitor"
      subtitle="Today’s shifts (Cashier, TrackMarshall) with web-app activity overlay (Telecaller, Incharge)."
      breadcrumbs={['Pipeline', 'Monitor']}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={data.refresh}
            disabled={data.refreshing || data.loadingInitial}
            className="ui-btn ui-btn-neutral min-h-8 px-3 text-xs"
          >
            {data.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <LiveRosterSection
          allowedBranchIds={allowedBranchIds}
          shifts={data.shifts}
          presence={data.presence}
          users={data.users}
          loading={data.loadingInitial}
          error={data.error}
          onRetry={data.refresh}
        />
        <SessionHistorySection
          allowedBranchIds={allowedBranchIds}
          shifts={data.shifts}
          users={data.users}
          loading={data.loadingInitial}
          error={data.error}
        />
      </div>
    </ModulePageLayout>
  )
}

export default MonitorModule
