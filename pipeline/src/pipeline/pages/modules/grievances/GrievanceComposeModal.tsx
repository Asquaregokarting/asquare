import { useEffect, useMemo, useState } from 'react'
import { listFirestoreUsers } from '../../../api/users-firestore'
import { sendGrievance, type GrievanceSeverity } from '../../../api/grievances-firestore'
import { logger } from '../../../../lib/logger'
import type { Role, UserRecord } from '../../../api/types'

interface GrievanceComposeModalProps {
  sender: { id: string; name: string; role: string }
  onClose: () => void
  onSent: (message: string) => void
}

type Mode = 'user' | 'role' | 'all'

const SELECTABLE_ROLES: Role[] = [
  'Owner',
  'Admin',
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Incharge',
  'Editor',
  'Developer',
  'Backend',
  'ThirdParty',
]

const SEVERITY_OPTIONS: Array<{
  value: GrievanceSeverity
  label: string
  hint: string
  toneClass: string
}> = [
  {
    value: 'info',
    label: 'Info',
    hint: 'General announcement.',
    toneClass: 'border-info/60 bg-info/10',
  },
  {
    value: 'success',
    label: 'Resolved',
    hint: 'Bug fixed / good news.',
    toneClass: 'border-success/60 bg-success/10',
  },
  {
    value: 'warning',
    label: 'Heads-up',
    hint: 'Action required soon.',
    toneClass: 'border-warning/60 bg-warning/10',
  },
  {
    value: 'critical',
    label: 'Urgent',
    hint: 'Read immediately.',
    toneClass: 'border-critical/60 bg-critical/10',
  },
]

const GrievanceComposeModal = ({ sender, onClose, onSent }: GrievanceComposeModalProps) => {
  const [mode, setMode] = useState<Mode>('role')
  const [targetUserId, setTargetUserId] = useState('')
  const [targetUserName, setTargetUserName] = useState('')
  const [targetRole, setTargetRole] = useState<Role>('Cashier')
  const [users, setUsers] = useState<UserRecord[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState<GrievanceSeverity>('info')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'user') return
    let cancelled = false
    setUsersLoading(true)
    listFirestoreUsers({ status: 'Active' })
      .then((rows) => {
        if (!cancelled) setUsers(rows)
      })
      .catch((err) => {
        logger.error('grievance_compose.users_load_failed', err)
        if (!cancelled) setError('Failed to load users.')
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users.slice(0, 50)
    return users
      .filter((u) =>
        `${u.name} ${u.username ?? ''} ${u.email} ${u.phone ?? ''} ${u.role}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 50)
  }, [users, search])

  const submit = async () => {
    setError(null)
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (!body.trim()) {
      setError('Message body is required.')
      return
    }
    if (mode === 'user' && !targetUserId) {
      setError('Pick a user from the list.')
      return
    }
    setSubmitting(true)
    try {
      await sendGrievance({
        title: title.trim(),
        body: body.trim(),
        severity,
        targetType: mode,
        targetUserId: mode === 'user' ? targetUserId : undefined,
        targetUserName: mode === 'user' ? targetUserName : undefined,
        targetRole: mode === 'role' ? targetRole : undefined,
        sentBy: sender,
      })
      const audience =
        mode === 'user'
          ? targetUserName || 'user'
          : mode === 'role'
            ? `${targetRole} role`
            : 'everyone'
      onSent(`Message sent to ${audience}.`)
      onClose()
    } catch (err) {
      logger.error('grievance_compose.submit_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to send message.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/70 p-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text">Send Message</h3>
            <p className="text-xs text-muted">Broadcast to a user, a role, or everyone.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
          >
            Close
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}

        <div className="space-y-5">
          {/* Audience picker */}
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Send To
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(['user', 'role', 'all'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-lg border p-3 text-left text-sm capitalize ${
                    mode === m
                      ? 'border-accent/60 bg-accent/10'
                      : 'border-border bg-panel hover:bg-panel/70'
                  }`}
                >
                  <span className="font-medium text-text">{m === 'all' ? 'Everyone' : m}</span>
                  <span className="block text-[11px] text-muted">
                    {m === 'user' ? 'One person' : m === 'role' ? 'All in a role' : 'All staff'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {mode === 'role' && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Role
              </span>
              <select
                className="ui-field min-h-10 w-full"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value as Role)}
              >
                {SELECTABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}

          {mode === 'user' && (
            <div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Find user
                </span>
                <input
                  className="ui-field min-h-10 w-full"
                  placeholder="Search name, email, phone, role…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-panel">
                {usersLoading ? (
                  <p className="px-3 py-4 text-center text-xs text-muted">Loading users…</p>
                ) : filteredUsers.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted">No matches.</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {filteredUsers.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setTargetUserId(u.id)
                            setTargetUserName(u.name)
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface/60 ${
                            targetUserId === u.id ? 'bg-accent/10' : ''
                          }`}
                        >
                          <div>
                            <p className="font-medium text-text">{u.name}</p>
                            <p className="text-[11px] text-muted">
                              {u.role}
                              {u.email ? ` · ${u.email}` : ''}
                            </p>
                          </div>
                          {targetUserId === u.id && (
                            <span className="text-[10px] uppercase text-accent">Selected</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Severity */}
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Tone
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSeverity(opt.value)}
                  className={`rounded-lg border p-2 text-left text-xs ${
                    severity === opt.value
                      ? opt.toneClass
                      : 'border-border bg-panel hover:bg-panel/70'
                  }`}
                >
                  <span className="block font-medium text-text">{opt.label}</span>
                  <span className="block text-[10px] text-muted">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title + body */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Title
            </span>
            <input
              className="ui-field min-h-10 w-full"
              placeholder="e.g. Bug fix — Billing duplicate cart issue resolved"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Message
            </span>
            <textarea
              className="ui-field min-h-24 w-full"
              rows={5}
              placeholder="Explain what happened, what's been done, and what (if anything) the recipient needs to do."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
            />
            <span className="mt-1 block text-right text-[10px] text-muted">{body.length}/2000</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="ui-btn ui-btn-neutral min-h-9 px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || !title.trim() || !body.trim()}
              className="ui-btn ui-btn-success min-h-9 px-4 py-1.5 text-xs disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GrievanceComposeModal
