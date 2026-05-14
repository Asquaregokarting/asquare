import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import type { Role, Ticket, TicketCategory, TicketPriority } from '../../../api/types'
import { subscribeToTicketCategories } from '../../../api/ticket-categories'
import { logger } from '../../../../lib/logger'
import { CommentThread } from './components/CommentThread'
import { ActivityLog } from './components/ActivityLog'
import { LinkedEntitiesPanel } from './components/LinkedEntitiesPanel'
import { TagEditor } from './components/TagEditor'
import { QuickActions } from './components/QuickActions'

type TabKey = 'details' | 'comments' | 'activity' | 'linked'

interface TicketDetailContentProps {
  ticket: Ticket
  actor: { id: string; name: string; role: Role }
  surface: 'modal' | 'route'
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'comments', label: 'Comments' },
  { key: 'activity', label: 'Activity' },
  { key: 'linked', label: 'Linked' },
]

const priorityTone = (p: TicketPriority): string => {
  switch (p) {
    case 'Critical':
      return 'bg-critical/15 text-critical'
    case 'High':
      return 'bg-warning/15 text-warning'
    case 'Normal':
      return 'bg-info/15 text-info'
    case 'Low':
      return 'bg-muted/15 text-muted'
  }
}

const statusTone = (status: Ticket['status']): string => {
  switch (status) {
    case 'Open':
      return 'bg-critical/15 text-critical'
    case 'In Progress':
      return 'bg-warning/15 text-warning'
    case 'Resolved':
      return 'bg-success/15 text-success'
    case 'Closed':
      return 'bg-muted/15 text-muted'
    default:
      return 'bg-muted/15 text-muted'
  }
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export const TicketDetailContent = ({ ticket, actor, surface }: TicketDetailContentProps) => {
  const [activeTab, setActiveTab] = useState<TabKey>('details')
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    unsubRef.current = subscribeToTicketCategories(
      (rows) => setCategories(rows),
      (err) => {
        logger.warn('ticket.categories_subscribe_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      },
    )
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const categoryLabel =
    categories.find((c) => c.id === ticket.categoryId)?.label ?? ticket.categoryId

  const renderHeader = () => (
    <header className="space-y-2 border-b border-border/45 p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="font-display text-lg font-semibold text-text">{ticket.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-mono">#{ticket.id}</span>
            <span aria-hidden="true">·</span>
            <span>{ticket.branchDisplayName}</span>
          </div>
        </div>
        {surface === 'modal' ? (
          <Link
            to={`/tickets/${ticket.id}`}
            className="inline-flex items-center gap-1 text-xs text-info underline-offset-2 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open full page
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs text-info">
          {categoryLabel}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${priorityTone(ticket.priority)}`}>
          {ticket.priority}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(ticket.status)}`}
        >
          {ticket.status}
        </span>
      </div>
    </header>
  )

  const renderTabs = () => (
    <nav
      className="flex gap-1 border-b border-border/45 px-4 lg:px-5"
      role="tablist"
      aria-label="Ticket sections"
    >
      {TABS.map((t) => {
        const isActive = activeTab === t.key
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </nav>
  )

  const renderTabBody = () => {
    if (activeTab === 'details') {
      return (
        <div className="space-y-4">
          <section className="rounded-lg border border-border/45 bg-surface p-4 text-sm text-text">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Description
            </h3>
            <p className="whitespace-pre-wrap">{ticket.description}</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Attachments</h3>
            {ticket.attachments.length === 0 ? (
              <p className="rounded-lg border border-border/45 bg-panel p-3 text-xs text-muted">
                No attachments.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {ticket.attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-2 py-1 text-xs text-text"
                  >
                    {a.kind === 'image' ? (
                      <img
                        src={a.url}
                        alt="attachment"
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : a.kind === 'voice' ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption -- voice attachments are user recordings without captions
                      <audio src={a.url} controls className="h-8 max-w-[180px]" />
                    ) : (
                      // eslint-disable-next-line jsx-a11y/media-has-caption -- video attachments are user recordings without captions
                      <video src={a.url} controls className="h-12 max-w-[200px] rounded" />
                    )}
                    <span className="text-muted">{formatBytes(a.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <TagEditor ticketId={ticket.id} tags={ticket.tags} actor={actor} />
          </section>
        </div>
      )
    }

    if (activeTab === 'comments') {
      return (
        <CommentThread
          ticketId={ticket.id}
          actor={actor}
          canPostInternal={actor.role !== 'ThirdParty'}
        />
      )
    }

    if (activeTab === 'activity') {
      return <ActivityLog ticketId={ticket.id} />
    }

    return (
      <LinkedEntitiesPanel entities={ticket.linkedEntities} ticketId={ticket.id} actor={actor} />
    )
  }

  if (surface === 'route') {
    return (
      <>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-panel">
          {renderHeader()}
          {renderTabs()}
          <div className="p-4 lg:p-5">{renderTabBody()}</div>
        </div>
        <aside className="rounded-xl border border-border/60 bg-panel p-4 lg:p-5">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            Quick actions
          </h3>
          <QuickActions ticket={ticket} actor={actor} />
        </aside>
      </>
    )
  }

  return (
    <div className="flex max-h-[calc(100vh-4rem)] flex-col">
      {renderHeader()}
      {renderTabs()}
      <div className="overflow-y-auto p-4 lg:p-5">{renderTabBody()}</div>
      <div className="border-t border-border/45 p-4 lg:p-5">
        <QuickActions ticket={ticket} actor={actor} />
      </div>
    </div>
  )
}
