import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Send,
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle,
  Info,
  RotateCcw,
  Ticket as TicketIcon,
} from 'lucide-react'
import SEO from '../components/SEO'
import { useAuth } from '../contexts/AuthContext'
import { ticketCustomerService } from '../services/ticketCustomerService'
import { logger } from '../lib/logger'
import type { Ticket, TicketComment, TicketStatus } from '../types'

const STATUS_BADGE: Record<TicketStatus, { label: string; cls: string; Icon: typeof CheckCircle }> =
  {
    Open: {
      label: 'Open',
      cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      Icon: AlertTriangle,
    },
    'In Progress': {
      label: 'In Progress',
      cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
      Icon: Clock,
    },
    Resolved: {
      label: 'Resolved',
      cls: 'bg-green-500/20 text-green-300 border-green-500/30',
      Icon: CheckCircle,
    },
    Closed: {
      label: 'Closed',
      cls: 'bg-white/10 text-white/60 border-white/10',
      Icon: CheckCircle,
    },
  }

function formatDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatETA(resolveDueAt: string | null, status: TicketStatus): string | null {
  if (!resolveDueAt) return null
  if (status === 'Resolved' || status === 'Closed') return null
  const due = new Date(resolveDueAt).getTime()
  if (Number.isNaN(due)) return null
  const diffSec = Math.round((due - Date.now()) / 1000)
  if (diffSec <= 0) return 'Overdue'
  const h = Math.round(diffSec / 3600)
  if (h < 1) return 'Resolves in <1h'
  if (h < 24) return `Resolves in ${h}h`
  const d = Math.round(h / 24)
  return `Resolves in ${d}d`
}

function isWithinReopenWindow(ticket: Ticket): boolean {
  if (ticket.status !== 'Resolved') return false
  if (!ticket.resolvedAt) return false
  const resolved = new Date(ticket.resolvedAt).getTime()
  if (Number.isNaN(resolved)) return false
  const REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000
  return Date.now() - resolved <= REOPEN_WINDOW_MS
}

export default function HelpTicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [comments, setComments] = useState<TicketComment[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')

  useEffect(() => {
    if (!ticketId || !user) {
      setLoading(false)
      return
    }
    let resolved = false
    const unsub = ticketCustomerService.subscribeToTicket(
      ticketId,
      user.id,
      (t) => {
        setTicket(t)
        resolved = true
        setLoading(false)
      },
      (err) => {
        logger.error('help.ticket_detail.subscribe_failed', err, { ticketId })
        if (!resolved) setLoading(false)
      },
    )
    return () => unsub()
  }, [ticketId, user])

  useEffect(() => {
    if (!ticketId) return
    const unsub = ticketCustomerService.subscribeToComments(
      ticketId,
      (rows) => setComments(rows),
      (err) => logger.error('help.ticket_detail.comments_failed', err, { ticketId }),
    )
    return () => unsub()
  }, [ticketId])

  const status = ticket ? (STATUS_BADGE[ticket.status] ?? STATUS_BADGE.Open) : null
  const eta = useMemo(
    () => (ticket ? formatETA(ticket.resolveDueAt, ticket.status) : null),
    [ticket],
  )
  const canReopen = ticket ? isWithinReopenWindow(ticket) : false

  const postComment = async (text: string): Promise<boolean> => {
    if (!user || !ticketId) return false
    const trimmed = text.trim()
    if (!trimmed) return false
    setPosting(true)
    setPostError(null)
    try {
      await ticketCustomerService.addComment({
        ticketId,
        authorId: user.id,
        authorName: user.displayName || 'Customer',
        body: trimmed,
        mentions: [],
      })
      return true
    } catch (err) {
      logger.error('help.ticket_detail.post_comment_failed', err, { ticketId })
      setPostError('Could not send. Try again.')
      return false
    } finally {
      setPosting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await postComment(body)
    if (ok) setBody('')
  }

  const handleReopenSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = reopenReason.trim()
    if (!trimmed) return
    const ok = await postComment(`Reopen requested: ${trimmed}`)
    if (ok) {
      setReopenReason('')
      setReopenOpen(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-dark-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <TicketIcon className="w-12 h-12 text-white/30 mb-3" />
        <h2 className="text-xl font-bold mb-1">Sign in to view this ticket</h2>
        <button
          onClick={() => navigate('/profile')}
          className="mt-4 px-5 py-2.5 bg-white text-dark-950 rounded-xl font-bold"
        >
          Sign in
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 text-white flex flex-col items-center justify-center p-6">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400 mb-3" />
        <p className="text-white/50 text-sm">Loading ticket…</p>
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-dark-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <TicketIcon className="w-12 h-12 text-white/30 mb-3" />
        <h2 className="text-xl font-bold mb-1">Ticket not found</h2>
        <p className="text-white/50 text-sm">
          It may have been removed or you don&rsquo;t have access.
        </p>
        <button
          onClick={() => navigate('/help')}
          className="mt-4 px-5 py-2.5 bg-white text-dark-950 rounded-xl font-bold"
        >
          Back to Help
        </button>
      </div>
    )
  }

  const StatusIcon = status?.Icon ?? CheckCircle

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-40">
      <SEO title={`Ticket ${ticket.id}`} description="Track your support ticket." noindex />

      <div className="px-4 py-6 flex items-center gap-3">
        <button
          onClick={() => navigate('/help')}
          className="w-10 h-10 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"
          aria-label="Back to Help"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-white/40 font-mono">
            {ticket.id}
          </p>
          <h1 className="text-lg font-bold truncate">{ticket.title || 'Ticket'}</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 space-y-5">
        {/* Status header */}
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {status && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${status.cls}`}
              >
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>
            )}
            <span className="px-2 py-1 rounded-full text-[10px] font-medium bg-white/5 text-white/70">
              {ticket.priority}
            </span>
            {eta && (
              <span
                className={`text-xs font-medium ${
                  eta === 'Overdue' ? 'text-red-400' : 'text-white/60'
                }`}
              >
                {eta}
              </span>
            )}
          </div>
          <p className="text-sm text-white/80 whitespace-pre-wrap">
            {ticket.description || ticket.issue}
          </p>
          <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-white/40 uppercase tracking-wider mb-0.5">Branch</p>
              <p className="text-white/80">{ticket.branchDisplayName || ticket.branchId || '—'}</p>
            </div>
            <div>
              <p className="text-white/40 uppercase tracking-wider mb-0.5">Created</p>
              <p className="text-white/80">{formatDateTime(ticket.createdAt)}</p>
            </div>
          </div>
        </div>

        {/* Comment thread */}
        <section>
          <h3 className="font-semibold text-white mb-3">Conversation</h3>
          <div className="space-y-3">
            {comments.length === 0 ? (
              <div className="card text-center py-6 text-white/50 text-sm">
                No replies yet. Add a comment below to share more details.
              </div>
            ) : (
              comments.map((c) => {
                const mine = c.authorId === user.id
                return (
                  <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                        mine
                          ? 'bg-primary-600/90 text-white rounded-br-sm'
                          : 'bg-dark-800 border border-white/5 text-white rounded-bl-sm'
                      }`}
                    >
                      <p className="text-[11px] font-medium mb-1 opacity-70">
                        {mine ? 'You' : c.authorName || 'Support'} · {formatDateTime(c.createdAt)}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Reopen request */}
        {canReopen && (
          <section className="card border-yellow-500/20 bg-yellow-500/5">
            {!reopenOpen ? (
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-yellow-300 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-white text-sm mb-1">
                    Marked as resolved — but not really?
                  </h4>
                  <p className="text-xs text-white/60 mb-3">
                    You can ask our team to take another look within 48 hours of resolution.
                  </p>
                  <button
                    type="button"
                    onClick={() => setReopenOpen(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-200 text-xs font-bold transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Request reopen
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleReopenSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="reopen-reason"
                    className="block text-xs uppercase tracking-wider text-white/40 mb-1.5"
                  >
                    Why should we reopen this?
                  </label>
                  <textarea
                    id="reopen-reason"
                    rows={3}
                    required
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary-500/50 transition-colors resize-y text-sm"
                    placeholder="Tell us what's still unresolved…"
                  />
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  Note: this posts your reason as a comment for the team. Status stays as Resolved
                  until staff manually reopens the ticket.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReopenOpen(false)
                      setReopenReason('')
                    }}
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-bold"
                    disabled={posting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={posting || !reopenReason.trim()}
                    className="flex-1 px-3 py-2 rounded-lg bg-yellow-500/30 hover:bg-yellow-500/40 text-yellow-100 text-xs font-bold disabled:opacity-50"
                  >
                    {posting ? 'Sending…' : 'Send reopen request'}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>

      {/* Composer (sticky bottom) */}
      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-dark-950 via-dark-950 to-transparent pt-6 pb-4 px-4"
      >
        <div className="max-w-2xl mx-auto">
          {postError && (
            <p role="alert" className="mb-2 text-xs text-red-400">
              {postError}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type a message…"
              className="flex-1 bg-dark-800 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary-500/50 transition-colors resize-none text-sm"
            />
            <button
              type="submit"
              disabled={posting || !body.trim()}
              className="h-12 px-4 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              aria-label="Post comment"
            >
              {posting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Post
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
