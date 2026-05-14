import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../features/auth/auth-context'
import {
  deleteGrievance,
  markGrievanceRead,
  subscribeMyGrievances,
  subscribeMyOutbox,
  type GrievanceRecord,
  type GrievanceSeverity,
} from '../../../api/grievances-firestore'
import { logger } from '../../../../lib/logger'
import GrievanceComposeModal from './GrievanceComposeModal'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'

const ALLOWED_SENDER_ROLES = ['Owner', 'Admin', 'Developer'] as const

const severityClass = (s: GrievanceSeverity): string => {
  switch (s) {
    case 'success':
      return 'border-success/40 bg-success/5'
    case 'warning':
      return 'border-warning/40 bg-warning/5'
    case 'critical':
      return 'border-critical/45 bg-critical/10'
    default:
      return 'border-info/40 bg-info/5'
  }
}

const severityBadge = (s: GrievanceSeverity): string => {
  switch (s) {
    case 'success':
      return 'bg-success/15 text-success'
    case 'warning':
      return 'bg-warning/15 text-warning'
    case 'critical':
      return 'bg-critical/15 text-critical'
    default:
      return 'bg-info/15 text-info'
  }
}

const audienceLabel = (g: GrievanceRecord): string => {
  if (g.targetType === 'user') return `To: ${g.targetUserName ?? g.targetUserId ?? '—'}`
  if (g.targetType === 'role') return `To: ${g.targetRole ?? '—'} role`
  return 'To: Everyone'
}

const GrievancesModule = () => {
  const { session } = useAuth()
  const [tab, setTab] = useState<'inbox' | 'outbox'>('inbox')
  const [inbox, setInbox] = useState<GrievanceRecord[]>([])
  const [outbox, setOutbox] = useState<GrievanceRecord[]>([])
  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canCompose = useMemo(
    () => !!session && ALLOWED_SENDER_ROLES.includes(session.user.role as 'Owner'),
    [session],
  )

  useEffect(() => {
    if (!session) return
    const unsubInbox = subscribeMyGrievances(
      { id: session.user.id, role: session.user.role },
      setInbox,
      (err) => {
        logger.error('grievances_module.inbox_subscribe_failed', err)
        setError('Failed to load messages.')
      },
    )
    return () => unsubInbox()
  }, [session])

  useEffect(() => {
    if (!session || !canCompose) return
    const unsubOutbox = subscribeMyOutbox(session.user.id, setOutbox, (err) => {
      logger.error('grievances_module.outbox_subscribe_failed', err)
    })
    return () => unsubOutbox()
  }, [session, canCompose])

  if (!session) return null
  const userId = session.user.id

  const unreadCount = inbox.filter((g) => !g.readBy[userId]).length
  const list = tab === 'inbox' ? inbox : outbox

  const handleOpen = async (g: GrievanceRecord) => {
    if (tab === 'inbox' && !g.readBy[userId]) {
      try {
        await markGrievanceRead(g.id, userId)
      } catch {
        /* non-critical */
      }
    }
  }

  const handleDelete = async (g: GrievanceRecord) => {
    if (!window.confirm(`Delete "${g.title}"? This cannot be undone.`)) return
    try {
      await deleteGrievance(g.id, userId)
      setSuccess('Message deleted.')
    } catch (err) {
      logger.error('grievances_module.delete_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to delete.')
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-xs underline">
            Dismiss
          </button>
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
          <button type="button" onClick={() => setSuccess(null)} className="ml-2 text-xs underline">
            Dismiss
          </button>
        </p>
      )}

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text">Messages</h2>
            <p className="text-xs text-muted">
              Announcements and direct messages from the Owner / Admin / Developer team.
            </p>
          </div>
          {canCompose && (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="ui-btn ui-btn-success min-h-9 px-3 py-1.5 text-xs"
            >
              + New Message
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('inbox')}
            className={`ui-btn min-h-8 px-3 py-1 text-xs ${
              tab === 'inbox' ? 'ui-btn-info' : 'ui-btn-neutral'
            }`}
          >
            Inbox{unreadCount > 0 ? ` (${unreadCount} unread)` : ''}
          </button>
          {canCompose && (
            <button
              type="button"
              onClick={() => setTab('outbox')}
              className={`ui-btn min-h-8 px-3 py-1 text-xs ${
                tab === 'outbox' ? 'ui-btn-info' : 'ui-btn-neutral'
              }`}
            >
              Sent
            </button>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {list.length === 0 ? (
            <p className="rounded-lg border border-border/60 bg-panel px-3 py-6 text-center text-sm text-muted">
              {tab === 'inbox' ? 'No messages yet.' : "You haven't sent any messages."}
            </p>
          ) : (
            list.map((g) => {
              const isUnread = tab === 'inbox' && !g.readBy[userId]
              const readCount = Object.keys(g.readBy).length
              return (
                <article
                  key={g.id}
                  className={`rounded-xl border p-4 transition ${severityClass(
                    g.severity,
                  )} ${isUnread ? 'ring-2 ring-info/40' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityBadge(g.severity)}`}
                        >
                          {g.severity}
                        </span>
                        {isUnread && (
                          <span className="rounded bg-info/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-info">
                            New
                          </span>
                        )}
                        <h3 className="truncate text-sm font-semibold text-text">{g.title}</h3>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-text/90">{g.body}</p>
                      <p className="mt-2 text-[11px] text-muted">
                        From {g.sentBy.name} ({g.sentBy.role}) ·{' '}
                        {fmtDateTimeFullIST(new Date(g.sentAt))}
                      </p>
                      <p className="text-[11px] text-muted">
                        {audienceLabel(g)}
                        {tab === 'outbox' ? ` · Read by ${readCount}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {tab === 'inbox' && isUnread && (
                        <button
                          type="button"
                          onClick={() => void handleOpen(g)}
                          className="ui-btn ui-btn-info min-h-7 px-2 py-1 text-[10px]"
                        >
                          Mark read
                        </button>
                      )}
                      {tab === 'outbox' && g.sentBy.id === userId && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(g)}
                          className="ui-btn ui-btn-critical min-h-7 px-2 py-1 text-[10px]"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </div>

      {composing && canCompose && (
        <GrievanceComposeModal
          sender={{ id: userId, name: session.user.name, role: session.user.role }}
          onClose={() => setComposing(false)}
          onSent={(message) => {
            setSuccess(message)
            setComposing(false)
            setTab('outbox')
          }}
        />
      )}
    </div>
  )
}

export default GrievancesModule
