import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../features/auth/auth-context'
import { useToast } from '../../../features/toast/toast-context'
import {
  setCannedResponseActive,
  subscribeToCannedResponses,
  upsertCannedResponse,
} from '../../../api/ticket-canned'
import { subscribeToTicketCategories } from '../../../api/ticket-categories'
import type {
  CreateTicketCannedPayload,
  TicketCannedResponse,
  TicketCategory,
} from '../../../api/types'
import { logger } from '../../../../lib/logger'

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `canned-${Date.now()}`

interface DraftState {
  id: string | null
  title: string
  body: string
  categoryIdsText: string
  active: boolean
  sortOrder: string
}

const draftFromCanned = (c: TicketCannedResponse): DraftState => ({
  id: c.id,
  title: c.title,
  body: c.body,
  categoryIdsText: c.categoryIds.join(', '),
  active: c.active,
  sortOrder: String(c.sortOrder),
})

const emptyDraft = (): DraftState => ({
  id: null,
  title: '',
  body: '',
  categoryIdsText: '',
  active: true,
  sortOrder: '99',
})

export const TicketCannedSettings = () => {
  const { session } = useAuth()
  const { success, error: toastError } = useToast()

  const role = session?.user.role
  const authorized = role === 'Owner' || role === 'Admin'

  const [rows, setRows] = useState<TicketCannedResponse[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!authorized) return
    const unsubscribe = subscribeToCannedResponses(
      (next) => {
        setRows(next)
        setLoading(false)
      },
      (err) => {
        logger.error('ticket_canned.subscribe_failed', err)
        setLoading(false)
      },
    )
    return () => {
      unsubscribe()
    }
  }, [authorized])

  useEffect(() => {
    if (!authorized) return
    const unsubscribe = subscribeToTicketCategories(
      (next) => setCategories(next),
      (err) => logger.error('ticket_canned.categories_subscribe_failed', err),
    )
    return () => {
      unsubscribe()
    }
  }, [authorized])

  const sorted = useMemo(() => [...rows].sort((a, b) => a.sortOrder - b.sortOrder), [rows])
  const activeCategoryIds = useMemo(
    () => new Set(categories.filter((c) => c.active).map((c) => c.id)),
    [categories],
  )

  if (!authorized) {
    return <div>Not authorized</div>
  }

  const handleAdd = () => {
    setValidationError(null)
    setDraft(emptyDraft())
  }

  const handleEdit = (c: TicketCannedResponse) => {
    setValidationError(null)
    setDraft(draftFromCanned(c))
  }

  const handleToggleActive = async (c: TicketCannedResponse) => {
    setTogglingId(c.id)
    try {
      await setCannedResponseActive(c.id, !c.active)
      success(`${c.title} ${c.active ? 'deactivated' : 'activated'}`)
    } catch (err) {
      logger.error(
        'ticket_canned.toggle_failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      toastError('Failed to toggle response')
    } finally {
      setTogglingId(null)
    }
  }

  const handleSave = async () => {
    if (!draft) return
    setValidationError(null)

    const title = draft.title.trim()
    if (!title) {
      setValidationError('Title is required')
      return
    }
    const body = draft.body.trim()
    if (!body) {
      setValidationError('Body is required')
      return
    }
    const sortOrder = Number(draft.sortOrder)
    if (!Number.isFinite(sortOrder)) {
      setValidationError('Sort order must be a number')
      return
    }

    const categoryIds = draft.categoryIdsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const unknown = categoryIds.filter((id) => !activeCategoryIds.has(id))
    if (unknown.length > 0) {
      setValidationError(
        `Unknown / inactive category id(s): ${unknown.join(', ')}. Leave blank to apply to all categories.`,
      )
      return
    }

    const id = draft.id ?? slugify(title)
    const payload: CreateTicketCannedPayload = {
      title,
      body,
      categoryIds,
      active: draft.active,
      sortOrder: Math.round(sortOrder),
    }

    setSaving(true)
    try {
      await upsertCannedResponse(id, payload)
      success(`Canned response ${title} saved`)
      setDraft(null)
    } catch (err) {
      logger.error('ticket_canned.save_failed', err instanceof Error ? err : new Error(String(err)))
      toastError('Failed to save response')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-text">Canned responses</h2>
          <p className="text-xs text-muted">
            Reusable replies for common questions. Triggered from the &ldquo;/&rdquo; menu in the
            ticket comment composer.
          </p>
        </div>
        <button type="button" onClick={handleAdd} className="ui-btn ui-btn-primary text-xs">
          Add response
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
          <p className="text-sm text-muted">No canned responses yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/45">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/45 bg-surface/50">
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Title</th>
                <th className="px-3 py-2.5 font-medium text-muted">Categories</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Order</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Active</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Edit</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="border-b border-border/30 transition hover:bg-surface/30">
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-text">
                    {c.title}
                    <div className="font-mono text-[10px] text-muted">{c.id}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">
                    {c.categoryIds.length === 0 ? 'All' : c.categoryIds.join(', ')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">{c.sortOrder}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      disabled={togglingId === c.id}
                      onClick={() => handleToggleActive(c)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.active ? 'bg-success/15 text-success' : 'bg-muted/15 text-muted'}`}
                    >
                      {togglingId === c.id ? '…' : c.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleEdit(c)}
                      className="ui-btn ui-btn-neutral text-xs"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 p-4"
        >
          <div className="w-full max-w-xl rounded-xl border border-border/60 bg-panel p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-text">
                {draft.id ? 'Edit response' : 'Add response'}
              </h3>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg p-1 text-muted transition hover:bg-surface hover:text-text"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Title</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                />
                {!draft.id ? (
                  <p className="mt-1 text-xs text-muted">
                    ID will be generated as <code>{slugify(draft.title || 'new-response')}</code>.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    ID: <code>{draft.id}</code>
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Body</label>
                <textarea
                  rows={5}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="w-full resize-y rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">
                  Category IDs (comma-separated, blank = all)
                </label>
                <input
                  type="text"
                  value={draft.categoryIdsText}
                  onChange={(e) => setDraft({ ...draft, categoryIdsText: e.target.value })}
                  className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                />
                <p className="mt-1 text-xs text-muted">
                  Active categories: {[...activeCategoryIds].join(', ') || 'none'}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Sort order</label>
                <input
                  type="number"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                  className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                Active
              </label>

              {validationError ? (
                <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
                  {validationError}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="ui-btn ui-btn-neutral text-xs"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="ui-btn ui-btn-primary text-xs"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default TicketCannedSettings
