import { lazy, Suspense } from 'react'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'

const EventCampaignListView = lazy(() => import('./event-campaigns/EventCampaignListView'))
const EventCampaignFormView = lazy(() => import('./event-campaigns/EventCampaignFormView'))

export type EventCampaignsView = 'manage' | 'create' | 'edit'

// Subnav intentionally empty: the surface only has one tab, so a
// single-item subnav is visual noise. Create / Edit are reached from
// the manage view's primary action and per-row More menu, not from
// the page header.
const subnav: Array<{ label: string; to: string }> = []

const titleMap: Record<EventCampaignsView, string> = {
  manage: 'Event Campaigns',
  create: 'Create Event Campaign',
  edit: 'Edit Event Campaign',
}

const subtitleMap: Record<EventCampaignsView, string> = {
  manage: 'Manage promotional event campaigns with custom pricing and offers.',
  create: 'Configure a new event campaign with selected games and offers.',
  edit: 'Update event campaign details, games, and pricing.',
}

const EventCampaignsModule = ({ view = 'manage' }: { view?: EventCampaignsView }) => (
  <ModulePageLayout
    moduleTab="EventCampaigns"
    title={titleMap[view]}
    subtitle={subtitleMap[view]}
    breadcrumbs={['Pipeline', 'Event Campaigns', ...(view !== 'manage' ? [titleMap[view]] : [])]}
    subnav={subnav}
  >
    <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading...</div>}>
      {view === 'manage' && <EventCampaignListView />}
      {(view === 'create' || view === 'edit') && <EventCampaignFormView mode={view} />}
    </Suspense>
  </ModulePageLayout>
)

export default EventCampaignsModule
