import { useNavigate } from 'react-router-dom'
import { CheckCircle, Clock, AlertTriangle, ChevronRight } from 'lucide-react'
import type { Ticket, TicketStatus, TicketPriority } from '../../types'

interface CustomerTicketCardProps {
  ticket: Ticket
}

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

const PRIORITY_PILL: Record<TicketPriority, string> = {
  Low: 'bg-white/5 text-white/60',
  Normal: 'bg-blue-500/10 text-blue-300',
  High: 'bg-orange-500/15 text-orange-300',
  Critical: 'bg-red-500/20 text-red-300',
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffSec = Math.round((Date.now() - t) / 1000)
  if (diffSec < 60) return 'just now'
  const m = Math.round(diffSec / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  return `${mo}mo ago`
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

export default function CustomerTicketCard({ ticket }: CustomerTicketCardProps) {
  const navigate = useNavigate()
  const status = STATUS_BADGE[ticket.status] ?? STATUS_BADGE.Open
  const StatusIcon = status.Icon
  const eta = formatETA(ticket.resolveDueAt, ticket.status)

  return (
    <button
      type="button"
      onClick={() => navigate(`/help/tickets/${ticket.id}`)}
      className="w-full text-left p-4 bg-dark-800 hover:bg-dark-700 border border-white/5 rounded-xl transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">
            {ticket.id}
          </p>
          <h4 className="text-sm font-semibold text-white truncate">{ticket.title || 'Ticket'}</h4>
        </div>
        <ChevronRight className="w-4 h-4 text-white/30 shrink-0 mt-1" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${status.cls}`}
        >
          <StatusIcon className="w-3 h-3" />
          {status.label}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${PRIORITY_PILL[ticket.priority]}`}
        >
          {ticket.priority}
        </span>
        <span className="text-[10px] text-white/40">{formatRelative(ticket.createdAt)}</span>
        {eta && (
          <span
            className={`text-[10px] font-medium ${
              eta === 'Overdue' ? 'text-red-400' : 'text-white/60'
            }`}
          >
            • {eta}
          </span>
        )}
      </div>
    </button>
  )
}
