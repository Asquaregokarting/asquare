import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { setTicketTags, type ActorIdentity } from '../../../../api/tickets-firestore'
import { useToast } from '../../../../features/toast/toast-context'
import { logger } from '../../../../../lib/logger'

interface TagEditorProps {
  ticketId: string
  tags: string[]
  actor: ActorIdentity
}

export const TagEditor = ({ ticketId, tags, actor }: TagEditorProps) => {
  const [local, setLocal] = useState<string[]>(tags)
  const [input, setInput] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedRef = useRef<string>(JSON.stringify(tags))
  const { error: toastError } = useToast()

  // When the ticket prop changes upstream, sync local state.
  useEffect(() => {
    const incoming = JSON.stringify(tags)
    if (incoming !== lastSyncedRef.current) {
      lastSyncedRef.current = incoming
      setLocal(tags)
    }
  }, [tags])

  // Debounce writes to firestore.
  useEffect(() => {
    const next = JSON.stringify(local)
    if (next === lastSyncedRef.current) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      lastSyncedRef.current = next
      setTicketTags(ticketId, local, actor).catch((err: unknown) => {
        logger.error(
          'ticket.set_tags_failed',
          err instanceof Error ? err : new Error(String(err)),
          { ticketId },
        )
        toastError('Failed to update tags')
      })
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [local, ticketId, actor, toastError])

  const addTag = (raw: string): void => {
    const trimmed = raw.trim()
    if (!trimmed) return
    if (local.includes(trimmed)) return
    setLocal((prev) => [...prev, trimmed])
  }

  const removeTag = (tag: string): void => {
    setLocal((prev) => prev.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(input)
      setInput('')
      return
    }
    if (e.key === 'Backspace' && input === '' && local.length > 0) {
      e.preventDefault()
      setLocal((prev) => prev.slice(0, -1))
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">Tags</p>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-surface p-2">
        {local.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-xs text-info"
          >
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              className="rounded-full p-0.5 hover:bg-info/25"
              aria-label={`Remove tag ${t}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={local.length === 0 ? 'Add tags…' : ''}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-xs text-text outline-none"
        />
      </div>
    </div>
  )
}
