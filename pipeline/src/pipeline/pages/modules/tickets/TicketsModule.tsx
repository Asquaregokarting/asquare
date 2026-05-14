import { useEffect } from 'react'
import { useAuth } from '../../../features/auth/auth-context'
import { ensureSeedCategories } from '../../../api/ticket-categories'
import { logger } from '../../../../lib/logger'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { TicketsListView } from './TicketsListView'
import { TicketsAnalyticsView } from './TicketsAnalyticsView'
import { TicketsBranchView } from './TicketsBranchView'
import { TicketsHeatmapView } from './TicketsHeatmapView'
import { TicketsKartFailureView } from './TicketsKartFailureView'
import { MyTicketsView } from './MyTicketsView'

export type TicketsModuleView = 'list' | 'analytics' | 'branch' | 'heatmap' | 'karts' | 'mine'

interface TicketsModuleProps {
  view?: TicketsModuleView
}

const SUBNAV = [
  { label: 'List', to: '/tickets' },
  { label: 'Analytics', to: '/tickets/analytics' },
  { label: 'Branch', to: '/tickets/branch' },
  { label: 'Heatmap', to: '/tickets/heatmap' },
  { label: 'Karts', to: '/tickets/karts' },
  { label: 'My tickets', to: '/tickets/mine' },
]

const TITLE_MAP: Record<TicketsModuleView, string> = {
  list: 'Tickets',
  analytics: 'Ticket Analytics',
  branch: 'Tickets by Branch',
  heatmap: 'Tickets Heatmap',
  karts: 'Kart Failures',
  mine: 'My Tickets',
}

const SUBTITLE_MAP: Record<TicketsModuleView, string> = {
  list: 'Triage open tickets across branches and categories.',
  analytics: 'Volume, MTTR, and resolution trends.',
  branch: 'Per-branch ticket roll-up.',
  heatmap: 'Branch × category × hour density.',
  karts: 'Kart-related failure incidents.',
  mine: 'Tickets you raised or are assigned to.',
}

const TicketsModule = ({ view = 'list' }: TicketsModuleProps) => {
  const { session } = useAuth()
  const role = session?.user.role ?? 'ThirdParty'
  const isOwnerOrDev = role === 'Owner' || role === 'Developer' || role === 'Admin'

  useEffect(() => {
    ensureSeedCategories().catch((err) =>
      logger.error(
        'ticket_category.seed_failed',
        err instanceof Error ? err : new Error(String(err)),
      ),
    )
  }, [])

  let content: React.ReactNode
  switch (view) {
    case 'analytics':
      content = <TicketsAnalyticsView />
      break
    case 'branch':
      content = <TicketsBranchView />
      break
    case 'heatmap':
      content = <TicketsHeatmapView />
      break
    case 'karts':
      content = <TicketsKartFailureView />
      break
    case 'mine':
      content = <MyTicketsView />
      break
    case 'list':
    default:
      content = <TicketsListView isOwnerOrDev={isOwnerOrDev} />
  }

  return (
    <ModulePageLayout
      moduleTab="Tickets"
      title={TITLE_MAP[view]}
      subtitle={SUBTITLE_MAP[view]}
      breadcrumbs={['Pipeline', 'Tickets', TITLE_MAP[view]]}
      subnav={SUBNAV}
    >
      {content}
    </ModulePageLayout>
  )
}

export default TicketsModule
