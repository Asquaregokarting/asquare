import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../features/auth/auth-context'
import { useToast } from '../../../features/toast/toast-context'
import {
  setCategoryActive,
  subscribeToTicketCategories,
  upsertCategory,
} from '../../../api/ticket-categories'
import type {
  CreateTicketCategoryPayload,
  Role,
  TicketCategory,
  TicketPriority,
} from '../../../api/types'
import { logger } from '../../../../lib/logger'

const ALL_ROLES: Role[] = [
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
  'HR',
  'Accountant',
]

const PRIORITY_OPTIONS: TicketPriority[] = ['Low', 'Normal', 'High', 'Critical']

const isRole = (value: string): value is Role =>
  (ALL_ROLES as ReadonlyArray<string>).includes(value)

const kebabCase = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `cat-${Date.now()}`

const formatSlaSummary = (responseSeconds: number | null, resolveSeconds: number): string => {
  const responseStr =
    responseSeconds == null
      ? '—'
      : responseSeconds % 60 === 0
        ? `${Math.round(responseSeconds / 60)}m`
        : `${responseSeconds}s`
  const resolveHours = resolveSeconds / 3600
  const resolveStr =
    resolveHours >= 1 && Number.isInteger(resolveHours)
      ? `${resolveHours}h`
      : `${resolveHours.toFixed(2).replace(/\.?0+$/, '')}h`
  return `${responseStr} / ${resolveStr}`
}

interface DraftState {
  id: string | null
  label: string
  priorityFloor: TicketPriority
  responseMinutes: string // empty string => null
  resolveHours: string
  routingChainText: string
  active: boolean
  sortOrder: string
}

const draftFromCategory = (cat: TicketCategory): DraftState => ({
  id: cat.id,
  label: cat.label,
  priorityFloor: cat.priorityFloor,
  responseMinutes:
    cat.responseSlaSeconds == null ? '' : String(Math.round(cat.responseSlaSeconds / 60)),
  resolveHours: String(cat.resolveSlaSeconds / 3600),
  routingChainText: cat.routingChain.join(', '),
  active: cat.active,
  sortOrder: String(cat.sortOrder),
})

const emptyDraft = (): DraftState => ({
  id: null,
  label: '',
  priorityFloor: 'Normal',
  responseMinutes: '60',
  resolveHours: '24',
  routingChainText: 'Incharge, Admin',
  active: true,
  sortOrder: '99',
})

export const TicketCategoriesSettings = () => {
  const { session } = useAuth()
  const { success, error: toastError } = useToast()

  const role = session?.user.role
  const authorized = role === 'Owner' || role === 'Admin'

  const [rows, setRows] = useState<TicketCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!authorized) return
    const unsubscribe = subscribeToTicketCategories(
      (next) => {
        setRows(next)
        setLoading(false)
      },
      (err) => {
        logger.error('ticket_category.subscribe_failed', err)
        setLoading(false)
      },
    )
    return () => {
      unsubscribe()
    }
  }, [authorized])

  const sorted = useMemo(() => [...rows].sort((a, b) => a.sortOrder - b.sortOrder), [rows])

  if (!authorized) {
    return <div>Not authorized</div>
  }

  const handleAdd = () => {
    setValidationError(null)
    setDraft(emptyDraft())
  }

  const handleEdit = (cat: TicketCategory) => {
    setValidationError(null)
    setDraft(draftFromCategory(cat))
  }

  const handleToggleActive = async (cat: TicketCategory) => {
    setTogglingId(cat.id)
    try {
      await setCategoryActive(cat.id, !cat.active)
      success(`${cat.label} ${cat.active ? 'deactivated' : 'activated'}`)
    } catch (err) {
      logger.error(
        'ticket_category.toggle_failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      toastError('Failed to toggle category')
    } finally {
      setTogglingId(null)
    }
  }

  const handleSave = async () => {
    if (!draft) return
    setValidationError(null)

    const label = draft.label.trim()
    if (!label) {
      setValidationError('Label is required')
      return
    }

    const responseMinutesStr = draft.responseMinutes.trim()
    let responseSlaSeconds: number | null
    if (responseMinutesStr === '') {
      responseSlaSeconds = null
    } else {
      const minutes = Number(responseMinutesStr)
      if (!Number.isFinite(minutes) || minutes < 0) {
        setValidationError(
          'Response SLA must be a non-negative number of minutes (or empty for none)',
        )
        return
      }
      responseSlaSeconds = Math.round(minutes * 60)
    }

    const hours = Number(draft.resolveHours)
    if (!Number.isFinite(hours) || hours <= 0) {
      setValidationError('Resolve SLA must be a positive number of hours')
      return
    }
    const resolveSlaSeconds = Math.round(hours * 3600)

    const sortOrder = Number(draft.sortOrder)
    if (!Number.isFinite(sortOrder)) {
      setValidationError('Sort order must be a number')
      return
    }

    const chainTokens = draft.routingChainText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (chainTokens.length === 0) {
      setValidationError('Routing chain must have at least one role')
      return
    }
    const invalidTokens = chainTokens.filter((t) => !isRole(t))
    if (invalidTokens.length > 0) {
      setValidationError(
        `Invalid role(s): ${invalidTokens.join(', ')}. Valid: ${ALL_ROLES.join(', ')}`,
      )
      return
    }
    const routingChain = chainTokens as Role[]

    const id = draft.id ?? kebabCase(label)
    const payload: CreateTicketCategoryPayload = {
      label,
      priorityFloor: draft.priorityFloor,
      responseSlaSeconds,
      resolveSlaSeconds,
      routingChain,
      active: draft.active,
      sortOrder: Math.round(sortOrder),
    }

    setSaving(true)
    try {
      await upsertCategory(id, payload)
      success(`Category ${label} saved`)
      setDraft(null)
    } catch (err) {
      logger.error(
        'ticket_category.save_failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      toastError('Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-text">Ticket categories</h2>
          <p className="text-xs text-muted">
            Drives priority floor, SLA, and routing chain for newly raised tickets.
          </p>
        </div>
        <button type="button" onClick={handleAdd} className="ui-btn ui-btn-primary text-xs">
          Add category
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
          <p className="text-sm text-muted">No categories yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/45">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/45 bg-surface/50">
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Label</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">
                  Priority Floor
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">
                  Response SLA
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">
                  Resolve SLA
                </th>
                <th className="px-3 py-2.5 font-medium text-muted">Routing chain</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Active</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">SLA (h:m)</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Edit</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((cat) => (
                <tr
                  key={cat.id}
                  className="border-b border-border/30 transition hover:bg-surface/30"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-text">
                    {cat.label}
                    <div className="font-mono text-[10px] text-muted">{cat.id}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">{cat.priorityFloor}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    {cat.responseSlaSeconds == null
                      ? '—'
                      : `${Math.round(cat.responseSlaSeconds / 60)} min`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    {cat.resolveSlaSeconds / 3600} h
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">{cat.routingChain.join(', ')}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      disabled={togglingId === cat.id}
                      onClick={() => handleToggleActive(cat)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cat.active ? 'bg-success/15 text-success' : 'bg-muted/15 text-muted'}`}
                    >
                      {togglingId === cat.id ? '…' : cat.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                    {formatSlaSummary(cat.responseSlaSeconds, cat.resolveSlaSeconds)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleEdit(cat)}
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
          <div className="w-full max-w-lg rounded-xl border border-border/60 bg-panel p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-text">
                {draft.id ? 'Edit category' : 'Add category'}
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
                <label className="mb-1 block text-xs font-medium text-muted">Label</label>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                />
                {!draft.id ? (
                  <p className="mt-1 text-xs text-muted">
                    ID will be generated as <code>{kebabCase(draft.label || 'new-category')}</code>.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    ID: <code>{draft.id}</code>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Priority floor
                  </label>
                  <select
                    value={draft.priorityFloor}
                    onChange={(e) =>
                      setDraft({ ...draft, priorityFloor: e.target.value as TicketPriority })
                    }
                    className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Response SLA (minutes)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g. 60 (blank = none)"
                    value={draft.responseMinutes}
                    onChange={(e) => setDraft({ ...draft, responseMinutes: e.target.value })}
                    className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Resolve SLA (hours)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={draft.resolveHours}
                    onChange={(e) => setDraft({ ...draft, resolveHours: e.target.value })}
                    className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">
                  Routing chain (comma-separated roles, in escalation order)
                </label>
                <textarea
                  rows={2}
                  value={draft.routingChainText}
                  onChange={(e) => setDraft({ ...draft, routingChainText: e.target.value })}
                  className="w-full resize-y rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
                />
                <p className="mt-1 text-xs text-muted">Valid roles: {ALL_ROLES.join(', ')}</p>
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

export default TicketCategoriesSettings
