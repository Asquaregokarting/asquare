import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { fmtDateTimeFullIST } from '../../../lib/date-format'
import { useNavigate } from 'react-router-dom'
import { trackApi } from '../../api/track'
import { IncidentRecord, KartRecord, QueueEntryRecord, SessionRecord } from '../../api/types'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable } from '../../components/ui/DataTable'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { useAuth } from '../../features/auth/auth-context'
import { KartsDashboard } from '../../features/track/karts/KartsDashboard'
import { KartReportsViewer } from '../../features/track/karts/KartReportsViewer'
import { WaitingListAdmin } from '../../features/track/waitingList/WaitingListDashboard'

const ScannerModule = lazy(() => import('../../features/track/scanner/ScannerModule'))

export type TrackView =
  | 'board'
  | 'karts'
  | 'sessions'
  | 'queue'
  | 'incidents'
  | 'scanner'
  | 'waiting'
  | 'reports'

const subnav = [
  { label: 'Board', to: '/track/board' },
  { label: 'Scanner', to: '/track/scanner' },
  { label: 'Karts', to: '/track/karts' },
  { label: 'Kart Reports', to: '/track/reports' },
  { label: 'Waiting List', to: '/track/waiting' },
  { label: 'Sessions', to: '/track/sessions' },
  { label: 'Queue', to: '/track/queue' },
  { label: 'Incidents', to: '/track/incidents' },
]

const titleMap: Record<TrackView, string> = {
  board: 'Track Status Board',
  karts: 'Kart Management',
  sessions: 'Session Management',
  queue: 'Queue Management',
  waiting: 'Waiting List',
  incidents: 'Incident Log',
  scanner: 'Go-Kart Scanner',
  reports: 'Kart Reports',
}

const subtitleMap: Record<TrackView, string> = {
  board: 'Live operational view for karts, sessions, queue, and safety.',
  karts: 'Maintain kart lifecycle and availability state.',
  sessions: 'Create and control active session flow.',
  queue: 'Manage waiting list and priority ordering.',
  waiting: 'Manage real-time waiting queue per kart type and location.',
  incidents: 'Log and resolve safety incidents.',
  scanner: 'QR-based booking validation and shift workflow.',
  reports: 'Daily kart inspection reports submitted by Track Marshalls.',
}

const safe = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await promise
  } catch {
    return fallback
  }
}

const TrackModule = ({ view }: { view: TrackView }) => {
  const { session } = useAuth()
  const navigate = useNavigate()
  const token = session?.token
  const canMutate = session
    ? ['Developer', 'TrackMarshall', 'Admin', 'Owner'].includes(session.user.role)
    : false
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [karts, setKarts] = useState<KartRecord[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [queue, setQueue] = useState<QueueEntryRecord[]>([])
  const [incidents, setIncidents] = useState<IncidentRecord[]>([])

  const loadAll = async () => {
    if (!token) return
    setLoading(true)
    setError(null)

    const [kartsResult, sessionsResult, queueResult, incidentsResult] = await Promise.all([
      safe(trackApi.listKarts(token), { karts: [] }),
      safe(trackApi.listSessions(token), { sessions: [] }),
      safe(trackApi.listQueue(token), { queue: [] }),
      safe(trackApi.listIncidents(token), { incidents: [] }),
    ])

    setKarts(kartsResult.karts)
    setSessions(sessionsResult.sessions)
    setQueue(queueResult.queue)
    setIncidents(incidentsResult.incidents)

    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view])

  const run = async (action: () => Promise<unknown>, message: string) => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await action()
      setSuccess(message)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setLoading(false)
    }
  }

  const sessionOptions = useMemo(() => sessions.map((item) => item.sessionName), [sessions])

  if (!session || !token) {
    return null
  }

  // "Kart Reports" sub-tab is only visible to Owner / Admin / Developer.
  const canViewKartReports = ['Owner', 'Admin', 'Developer'].includes(session.user.role)
  const visibleSubnav = subnav.filter((item) => item.to !== '/track/reports' || canViewKartReports)

  return (
    <ModulePageLayout
      moduleTab="Track"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Track', titleMap[view]]}
      subnav={visibleSubnav}
    >
      {error ? (
        <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      ) : null}

      {view === 'board' ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 ">
          <button
            type="button"
            onClick={() => void navigate('/track/scanner')}
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left active:scale-[0.99] dark:border-gray-700 dark:bg-track-surface"
          >
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-2xl font-bold text-white">
              SC
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-white">Go Kart Scanner</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-white/50">
                QR-based booking validation tool
              </p>
            </div>
            <span className="ml-auto shrink-0 text-gray-500 dark:text-white/50">Open</span>
          </button>

          <DetailPanel title="Live Sessions">
            <ul className="space-y-2 text-sm">
              {sessions.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-border/70 bg-panel px-3 py-2.5"
                >
                  {item.sessionName} - {item.status}
                </li>
              ))}
            </ul>
          </DetailPanel>

          <DetailPanel title="Safety Alerts">
            <ul className="space-y-2 text-sm">
              {incidents.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-border/70 bg-panel px-3 py-2.5"
                >
                  {item.incidentType} - {item.status}
                </li>
              ))}
            </ul>
          </DetailPanel>
        </div>
      ) : null}

      {view === 'karts' ? <KartsDashboard /> : null}

      {view === 'reports' ? <KartReportsViewer /> : null}

      {view === 'sessions' ? (
        <div className={`grid grid-cols-1 gap-4 ${canMutate ? 'xl:grid-cols-2' : ''}`}>
          {canMutate ? (
            <DetailPanel title="Create Session">
              <form
                className="grid grid-cols-1 gap-2"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  const formData = new FormData(event.currentTarget)
                  void run(
                    () =>
                      trackApi.createSession(token, {
                        sessionName: String(formData.get('sessionName') ?? 'Session'),
                        startTime: new Date(
                          String(formData.get('startTime') ?? new Date().toISOString()),
                        ).toISOString(),
                        duration: Number(formData.get('duration') ?? 10),
                        maxParticipants: Number(formData.get('maxParticipants') ?? 5),
                        assignedKarts: karts.slice(0, 2).map((kart) => kart.id),
                        status: 'Scheduled',
                      }),
                    'Session created.',
                  )
                  event.currentTarget.reset()
                }}
              >
                <input
                  className="ui-field min-h-10"
                  name="sessionName"
                  placeholder="Session name"
                  required
                />
                <input
                  className="ui-field min-h-10"
                  name="startTime"
                  type="datetime-local"
                  required
                />
                <input
                  className="ui-field min-h-10"
                  name="duration"
                  type="number"
                  defaultValue={15}
                  min={1}
                  required
                />
                <input
                  className="ui-field min-h-10"
                  name="maxParticipants"
                  type="number"
                  defaultValue={8}
                  min={1}
                  required
                />
                <button type="submit" className="ui-btn ui-btn-primary">
                  Create Session
                </button>
              </form>
            </DetailPanel>
          ) : null}

          <DataTable
            columns={[
              { key: 'name', header: 'Session', render: (item) => item.sessionName },
              { key: 'status', header: 'Status', render: (item) => item.status },
              {
                key: 'start',
                header: 'Start',
                render: (item) => fmtDateTimeFullIST(item.startTime),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (item) =>
                  canMutate ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            () => trackApi.updateSession(token, item.id, { status: 'Active' }),
                            'Session activated.',
                          )
                        }
                        className="ui-btn ui-btn-info min-h-8 px-2 py-1 text-xs"
                      >
                        Activate
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            () => trackApi.updateSession(token, item.id, { status: 'Completed' }),
                            'Session completed.',
                          )
                        }
                        className="ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs"
                      >
                        Complete
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Read-only</span>
                  ),
              },
            ]}
            rows={sessions}
            rowKey={(item) => item.id}
            emptyMessage={loading ? 'Loading sessions...' : 'No sessions found.'}
          />
        </div>
      ) : null}

      {view === 'queue' ? (
        <>
          {canMutate ? (
            <DetailPanel title="Add Queue Entry">
              <form
                className="grid grid-cols-1 gap-2 md:grid-cols-4"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  const formData = new FormData(event.currentTarget)
                  void run(
                    () =>
                      trackApi.createQueue(token, {
                        customerName: String(formData.get('customerName') ?? ''),
                        customerPhone: String(formData.get('customerPhone') ?? ''),
                        sessionPreference:
                          String(formData.get('sessionPreference') ?? '') || undefined,
                        priority: String(formData.get('priority') ?? 'Normal') as
                          | 'Normal'
                          | 'Priority',
                        estimatedWaitMinutes: Number(formData.get('estimatedWaitMinutes') ?? 0),
                      }),
                    'Queue entry created.',
                  )
                  event.currentTarget.reset()
                }}
              >
                <input
                  className="ui-field min-h-10"
                  name="customerName"
                  placeholder="Customer name"
                  required
                />
                <input
                  className="ui-field min-h-10"
                  name="customerPhone"
                  placeholder="Phone"
                  required
                />
                <input
                  className="ui-field min-h-10"
                  name="sessionPreference"
                  list="session-options"
                  placeholder="Session preference"
                />
                <datalist id="session-options">
                  {sessionOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                <select className="ui-field min-h-10" name="priority" defaultValue="Normal">
                  <option value="Normal">Normal</option>
                  <option value="Priority">Priority</option>
                </select>
                <input
                  className="ui-field min-h-10"
                  name="estimatedWaitMinutes"
                  type="number"
                  min={0}
                  defaultValue={20}
                />
                <button type="submit" className="ui-btn ui-btn-primary">
                  Add to Queue
                </button>
              </form>
            </DetailPanel>
          ) : null}

          <DataTable
            columns={[
              { key: 'customer', header: 'Customer', render: (item) => item.customerName },
              { key: 'priority', header: 'Priority', render: (item) => item.priority },
              { key: 'status', header: 'Status', render: (item) => item.status },
              { key: 'wait', header: 'Wait (min)', render: (item) => item.estimatedWaitMinutes },
              {
                key: 'actions',
                header: 'Actions',
                render: (item) =>
                  canMutate ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            () => trackApi.updateQueue(token, item.id, { status: 'Notified' }),
                            'Queue entry notified.',
                          )
                        }
                        className="ui-btn ui-btn-info min-h-8 px-2 py-1 text-xs"
                      >
                        Notify
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            () => trackApi.deleteQueue(token, item.id),
                            'Queue entry removed.',
                          )
                        }
                        className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Read-only</span>
                  ),
              },
            ]}
            rows={queue}
            rowKey={(item) => item.id}
            emptyMessage={loading ? 'Loading queue...' : 'No queue entries.'}
          />
        </>
      ) : null}

      {view === 'incidents' ? (
        <>
          {canMutate ? (
            <DetailPanel title="Log Incident">
              <form
                className="grid grid-cols-1 gap-2 md:grid-cols-3"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  const formData = new FormData(event.currentTarget)
                  void run(
                    () =>
                      trackApi.createIncident(token, {
                        incidentType: String(formData.get('incidentType') ?? 'Minor') as
                          | 'Minor'
                          | 'Major'
                          | 'EquipmentFailure'
                          | 'Medical',
                        dateTime: new Date(
                          String(formData.get('dateTime') ?? new Date().toISOString()),
                        ).toISOString(),
                        description: String(formData.get('description') ?? ''),
                        actionTaken: String(formData.get('actionTaken') ?? ''),
                        status: 'Open',
                      }),
                    'Incident logged.',
                  )
                  event.currentTarget.reset()
                }}
              >
                <select className="ui-field min-h-10" name="incidentType">
                  <option value="Minor">Minor</option>
                  <option value="Major">Major</option>
                  <option value="EquipmentFailure">Equipment Failure</option>
                  <option value="Medical">Medical</option>
                </select>
                <input
                  className="ui-field min-h-10"
                  name="dateTime"
                  type="datetime-local"
                  required
                />
                <input
                  className="ui-field min-h-10"
                  name="description"
                  placeholder="Description"
                  required
                />
                <input
                  className="ui-field min-h-10"
                  name="actionTaken"
                  placeholder="Action taken"
                  required
                />
                <button type="submit" className="ui-btn ui-btn-danger">
                  Log Incident
                </button>
              </form>
            </DetailPanel>
          ) : null}

          <DataTable
            columns={[
              { key: 'type', header: 'Type', render: (item) => item.incidentType },
              { key: 'status', header: 'Status', render: (item) => item.status },
              {
                key: 'time',
                header: 'Date & Time',
                render: (item) => fmtDateTimeFullIST(item.dateTime),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (item) =>
                  canMutate ? (
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          () => trackApi.updateIncident(token, item.id, { status: 'Resolved' }),
                          'Incident resolved.',
                        )
                      }
                      className="ui-btn ui-btn-success min-h-8 px-2 py-1 text-xs"
                    >
                      Mark Resolved
                    </button>
                  ) : (
                    <span className="text-xs text-muted">Read-only</span>
                  ),
              },
            ]}
            rows={incidents}
            rowKey={(item) => item.id}
            emptyMessage={loading ? 'Loading incidents...' : 'No incidents logged.'}
          />
        </>
      ) : null}

      {view === 'waiting' ? <WaitingListAdmin /> : null}

      {view === 'scanner' ? (
        <Suspense fallback={<div className="py-12 text-center text-muted">Loading scanner...</div>}>
          <ScannerModule embedded />
        </Suspense>
      ) : null}
    </ModulePageLayout>
  )
}

export default TrackModule
