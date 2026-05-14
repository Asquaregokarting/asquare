import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { useAuth } from '../../features/auth/auth-context'
import { isPrivilegedRole } from '../../api/firestore-session'
import LeadPipelineView from './leads/LeadPipelineView'
import LeadInboxView from './leads/LeadInboxView'
import LeadMetricsView from './leads/LeadMetricsView'
import LeadImportView from './leads/LeadImportView'
import LeadConfigView from './leads/LeadConfigView'
import InteraktDashboard from './leads/InteraktDashboard'
import FeedbackCallsInboxView from './leads/feedback-calls/FeedbackCallsInboxView'
import FeedbackMetricsView from './leads/feedback-calls/FeedbackMetricsView'
import LeadPerformanceView from './leads/LeadPerformanceView'

export type LeadsView =
  | 'pipeline'
  | 'inbox'
  | 'metrics'
  | 'import'
  | 'config'
  | 'interakt'
  | 'feedbackcalls'
  | 'feedbackmetrics'
  | 'performance'

const titleMap: Record<LeadsView, string> = {
  pipeline: 'Lead Pipeline',
  inbox: 'My Leads',
  metrics: 'Lead Analytics',
  import: 'Import Leads',
  config: 'Lead Settings',
  interakt: 'Interakt Events',
  feedbackcalls: 'Feedback Calls',
  feedbackmetrics: 'Feedback Analytics',
  performance: 'Performance',
}

const subtitleMap: Record<LeadsView, string> = {
  pipeline: 'Kanban board of all leads across the pipeline.',
  inbox: 'Your assigned leads — call, update, and convert.',
  metrics: 'Conversion funnel, source breakdown, and performance metrics.',
  import: 'Upload an Excel file to bulk-import leads.',
  config: 'Configure automation rules, scoring weights, and thresholds.',
  interakt: 'WhatsApp engagement, payments, orders, and alerts from Interakt.',
  feedbackcalls: "Call yesterday's players, capture ratings, surface issues.",
  feedbackmetrics: 'Completion rate, average rating, telecaller leaderboard, and issue trends.',
  performance: 'Daily/weekly performance stats, conversion leaderboard, and export reports.',
}

const LeadsModule = ({ view }: { view: LeadsView }) => {
  const { session } = useAuth()
  const role = session?.user.role
  const isAdmin = role ? isPrivilegedRole(role) : false

  const subnav = [
    ...(isAdmin ? [{ label: 'Pipeline', to: '/leads/pipeline' }] : []),
    { label: 'My Leads', to: '/leads/inbox' },
    { label: 'Feedback Calls', to: '/leads/feedback-calls' },
    { label: 'Performance', to: '/leads/performance' },
    ...(isAdmin
      ? [
          { label: 'Feedback Analytics', to: '/leads/feedback-metrics' },
          { label: 'Analytics', to: '/leads/metrics' },
          { label: 'Interakt', to: '/leads/interakt' },
          { label: 'Import', to: '/leads/import' },
          { label: 'Settings', to: '/leads/config' },
        ]
      : []),
  ]

  return (
    <ModulePageLayout
      moduleTab="Leads"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Leads', titleMap[view]]}
      subnav={subnav}
    >
      {view === 'pipeline' && <LeadPipelineView />}
      {view === 'inbox' && <LeadInboxView />}
      {view === 'metrics' && <LeadMetricsView />}
      {view === 'interakt' && <InteraktDashboard />}
      {view === 'import' && <LeadImportView />}
      {view === 'config' && <LeadConfigView />}
      {view === 'feedbackcalls' && <FeedbackCallsInboxView />}
      {view === 'feedbackmetrics' && <FeedbackMetricsView />}
      {view === 'performance' && <LeadPerformanceView />}
    </ModulePageLayout>
  )
}

export default LeadsModule
