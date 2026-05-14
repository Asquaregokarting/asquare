import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type {
  Role,
  TicketCannedResponse,
  TicketComment,
  TicketKbArticle,
  UserRecord,
} from '../../../../api/types'
import { addTicketComment, subscribeToTicketComments } from '../../../../api/ticket-comments'
import { subscribeToCannedResponses } from '../../../../api/ticket-canned'
import { subscribeToTicketKbArticles } from '../../../../api/ticket-kb'
import { extractMentions, type KnownUser } from '../../../../api/ticket-mentions'
import { listFirestoreUsers } from '../../../../api/users-firestore'
import { useToast } from '../../../../features/toast/toast-context'
import { logger } from '../../../../../lib/logger'

interface CommentThreadProps {
  ticketId: string
  actor: { id: string; name: string; role: Role }
  canPostInternal: boolean
}

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const formatTimestamp = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    })
  } catch {
    return iso
  }
}

interface SlashItem {
  kind: 'canned' | 'kb'
  id: string
  title: string
  body: string
}

interface SlashState {
  open: boolean
  /** Index in the textarea where the leading "/" sits. */
  slashIndex: number
  /** Filter text typed after the slash. */
  filter: string
}

const CLOSED_SLASH_STATE: SlashState = { open: false, slashIndex: -1, filter: '' }

/**
 * Detect a "/" trigger at the cursor position. The slash must be either at
 * the start of the string or immediately preceded by whitespace, and may be
 * followed by 0+ alphanumerics (the filter).
 */
function detectSlashTrigger(value: string, cursor: number): SlashState {
  // Walk backwards from the cursor looking for whitespace or start-of-string.
  let i = cursor - 1
  while (i >= 0) {
    const ch = value[i]
    if (ch === '/') {
      const before = i === 0 ? '' : value[i - 1]
      if (before === '' || /\s/.test(before)) {
        const filter = value.slice(i + 1, cursor)
        if (/^[a-zA-Z0-9]*$/.test(filter)) {
          return { open: true, slashIndex: i, filter }
        }
      }
      return CLOSED_SLASH_STATE
    }
    if (/\s/.test(ch)) return CLOSED_SLASH_STATE
    if (!/[a-zA-Z0-9]/.test(ch)) return CLOSED_SLASH_STATE
    i -= 1
  }
  return CLOSED_SLASH_STATE
}

const userToKnown = (u: UserRecord): KnownUser => ({
  id: u.id,
  name: u.name,
  handle: u.username ?? undefined,
})

export const CommentThread = ({ ticketId, actor, canPostInternal }: CommentThreadProps) => {
  const [comments, setComments] = useState<TicketComment[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [canned, setCanned] = useState<TicketCannedResponse[]>([])
  const [kb, setKb] = useState<TicketKbArticle[]>([])
  const [users, setUsers] = useState<KnownUser[]>([])
  const [slash, setSlash] = useState<SlashState>(CLOSED_SLASH_STATE)
  const { error: toastError } = useToast()
  const unsubRef = useRef<(() => void) | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setLoading(true)
    unsubRef.current = subscribeToTicketComments(
      ticketId,
      (rows) => {
        setComments(rows)
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        logger.error(
          'ticket.comments_subscribe_failed',
          err instanceof Error ? err : new Error(String(err)),
          { ticketId },
        )
      },
    )
    return () => {
      unsubRef.current?.()
    }
  }, [ticketId])

  useEffect(() => {
    const unsubCanned = subscribeToCannedResponses(
      (rows) => setCanned(rows.filter((r) => r.active)),
      (err) =>
        logger.error(
          'ticket.canned_subscribe_failed',
          err instanceof Error ? err : new Error(String(err)),
        ),
    )
    const unsubKb = subscribeToTicketKbArticles(
      { visibility: 'internal', activeOnly: true },
      (rows) => setKb(rows),
      (err) =>
        logger.error(
          'ticket.kb_subscribe_failed',
          err instanceof Error ? err : new Error(String(err)),
        ),
    )
    return () => {
      unsubCanned()
      unsubKb()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    listFirestoreUsers({ status: 'Active' })
      .then((rows) => {
        if (!cancelled) setUsers(rows.map(userToKnown))
      })
      .catch((err) => {
        logger.error(
          'ticket.users_load_failed',
          err instanceof Error ? err : new Error(String(err)),
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = comments.filter((c) => (actor.role === 'ThirdParty' ? !c.internal : true))

  const slashItems = useMemo<SlashItem[]>(() => {
    const items: SlashItem[] = [
      ...canned.map<SlashItem>((c) => ({
        kind: 'canned',
        id: c.id,
        title: c.title,
        body: c.body,
      })),
      ...kb.map<SlashItem>((a) => ({
        kind: 'kb',
        id: a.id,
        title: a.title,
        body: a.body,
      })),
    ]
    if (!slash.open) return items
    const f = slash.filter.toLowerCase()
    if (!f) return items
    return items.filter(
      (it) => it.title.toLowerCase().includes(f) || it.body.toLowerCase().includes(f),
    )
  }, [canned, kb, slash])

  const handleBodyChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setBody(next)
    const cursor = e.target.selectionStart ?? next.length
    setSlash(detectSlashTrigger(next, cursor))
  }

  const handleBodyKeyOrClick = () => {
    const el = textareaRef.current
    if (!el) return
    const cursor = el.selectionStart ?? el.value.length
    setSlash(detectSlashTrigger(el.value, cursor))
  }

  const insertSlashItem = (item: SlashItem) => {
    if (!slash.open) return
    const before = body.slice(0, slash.slashIndex)
    const afterIdx = slash.slashIndex + 1 + slash.filter.length
    const after = body.slice(afterIdx)
    const next = `${before}${item.body}${after}`
    setBody(next)
    setSlash(CLOSED_SLASH_STATE)
    // Restore focus and place cursor after the inserted body.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      const caret = (before + item.body).length
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const mentionMatches = extractMentions(trimmed, users)
      const mentions = mentionMatches.map((m) => m.userId)
      await addTicketComment({
        ticketId,
        authorId: actor.id,
        authorName: actor.name,
        authorKind: 'staff',
        body: trimmed,
        internal: canPostInternal && internal,
        mentions,
      })
      setBody('')
      setInternal(false)
      setSlash(CLOSED_SLASH_STATE)
    } catch (err) {
      logger.error(
        'ticket.comment_post_failed',
        err instanceof Error ? err : new Error(String(err)),
        { ticketId },
      )
      toastError('Failed to post comment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-border/45 bg-panel p-6 text-center text-sm text-muted">
          No comments yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((c) => (
            <li
              key={c.id}
              className={`rounded-lg border p-3 ${
                c.internal ? 'border-warning/40 bg-warning/5' : 'border-border/45 bg-surface'
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {initials(c.authorName)}
                </span>
                <span className="font-medium text-text">{c.authorName}</span>
                {c.internal ? (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                    Internal
                  </span>
                ) : null}
                <span className="ml-auto text-muted">{formatTimestamp(c.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-text">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-2 rounded-lg border border-border/45 bg-panel p-3"
      >
        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={3}
            value={body}
            onChange={handleBodyChange}
            onKeyUp={handleBodyKeyOrClick}
            onClick={handleBodyKeyOrClick}
            onBlur={() => {
              // Defer so a click on a slash item still fires.
              window.setTimeout(() => setSlash(CLOSED_SLASH_STATE), 120)
            }}
            placeholder="Add a comment… type / for canned replies and KB, @name to mention"
            className="w-full resize-y rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30"
            disabled={submitting}
          />
          {slash.open && slashItems.length > 0 ? (
            <ul
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border/60 bg-panel p-1 text-sm shadow-lg"
              aria-label="Insert canned response or knowledge-base article"
            >
              {slashItems.slice(0, 8).map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // Prevent the textarea blur from firing first.
                      e.preventDefault()
                    }}
                    onClick={() => insertSlashItem(item)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition hover:bg-surface"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                          item.kind === 'canned'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-info/15 text-info'
                        }`}
                      >
                        {item.kind === 'canned' ? 'Canned' : 'KB'}
                      </span>
                      <span className="truncate text-text">{item.title}</span>
                    </div>
                    <span className="line-clamp-1 text-xs text-muted">{item.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              disabled={!canPostInternal || submitting}
            />
            Internal note (staff only)
          </label>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="ui-btn ui-btn-primary text-xs"
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  )
}
