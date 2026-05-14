import { useEffect, useRef, useState } from 'react'
import type { TicketActivity, TicketActivityType } from '../../../../api/types'
import { subscribeToTicketActivity } from '../../../../api/ticket-activity'
import { logger } from '../../../../../lib/logger'

interface ActivityLogProps {
  ticketId: string
}

const summarize = (activity: TicketActivity): string => {
  const { type, payload } = activity
  const get = (key: string): string => {
    const v = payload[key]
    return typeof v === 'string' ? v : v == null ? '' : String(v)
  }

  switch (type) {
    case 'created':
      return 'Created the ticket'
    case 'status_changed':
      return `${get('from')} → ${get('to')}`
    case 'assignee_changed':
      return `Assigned to ${get('toName')}`
    case 'priority_changed':
      return `Priority changed to ${get('to')}`
    case 'category_changed':
      return `Category changed to ${get('toLabel')}`
    case 'tags_changed': {
      const tags = Array.isArray(payload.tags)
        ? (payload.tags as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      return `Tags: ${tags.join(', ') || '(none)'}`
    }
    case 'comment_added':
      return `Posted a ${payload.internal ? 'internal note' : 'comment'}`
    case 'attachment_added':
      return `Added a ${get('kind') || 'attachment'}`
    case 'attachment_removed':
      return `Removed a ${get('kind') || 'attachment'}`
    case 'linked_entity_added':
      return `Linked ${get('type')} ${get('id')}`
    case 'linked_entity_removed':
      return `Unlinked ${get('type')} ${get('id')}`
    case 'resolved':
      return `Resolved (${get('rootCauseTag')})`
    case 'reopened':
      return `Reopened: ${get('reason')}`
    case 'merged':
      return `Merged into ${get('targetId') || get('sourceId')}`
    case 'sla_response_breached':
    case 'sla_resolve_breached':
      return `SLA breach (${type})`
    case 'escalated':
      return `Escalated to ${get('toRole')}`
    default: {
      const exhaustive: TicketActivityType = type
      return exhaustive
    }
  }
}

const relativeTime = (iso: string): string => {
  try {
    const then = new Date(iso).getTime()
    const now = Date.now()
    const diffMs = now - then
    if (diffMs < 60_000) return 'just now'
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return new Date(iso).toLocaleDateString('en-IN')
  } catch {
    return iso
  }
}

export const ActivityLog = ({ ticketId }: ActivityLogProps) => {
  const [activities, setActivities] = useState<TicketActivity[]>([])
  const [loading, setLoading] = useState(true)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setLoading(true)
    unsubRef.current = subscribeToTicketActivity(
      ticketId,
      (rows) => {
        setActivities(rows)
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        logger.error(
          'ticket.activity_subscribe_failed',
          err instanceof Error ? err : new Error(String(err)),
          { ticketId },
        )
      },
    )
    return () => {
      unsubRef.current?.()
    }
  }, [ticketId])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-border/45 bg-panel p-6 text-center text-sm text-muted">
        No activity yet.
      </div>
    )
  }

  return (
    <ol className="space-y-2">
      {activities.map((a) => (
        <li
          key={a.id}
          className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border/45 bg-surface px-3 py-2 text-sm"
        >
          <span className="font-medium text-text">{a.actorName || 'System'}</span>
          <span className="text-muted">{summarize(a)}</span>
          <span className="ml-auto text-xs text-muted">{relativeTime(a.createdAt)}</span>
        </li>
      ))}
    </ol>
  )
}
