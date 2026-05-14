import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Calendar as CalendarIcon, Check, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import {
  createHRCalendarEntry,
  listHRCalendarEntries,
  softDeleteHRCalendarEntry,
  updateHRCalendarEntryStatus,
} from '../../../api/hr-calendar-firestore'
import { listFirestoreUsers } from '../../../api/users-firestore'
import { HRCalendarEntry, HRCalendarKind } from '../../../api/types'
import EmptyState from '../../../../components/ui/EmptyState'
import Skeleton from '../../../../components/ui/Skeleton'
import { logger } from '../../../../lib/logger'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'

export type HRCalendarView = 'calendar' | 'todos' | 'reminders'

const subnav = [
  { label: 'Calendar', to: '/hr/calendar' },
  { label: 'To-dos', to: '/hr/calendar/todos' },
  { label: 'Reminders', to: '/hr/calendar/reminders' },
]

const monthKey = (year: number, month: number): string =>
  `${year}-${String(month + 1).padStart(2, '0')}`

const todayIso = (): string => {
  const now = new Date()
  return new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 10)
}

const HRCalendarModule = ({ view }: { view: HRCalendarView }) => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const queryClient = useQueryClient()
  const today = new Date()
  const [cursorYear, setCursorYear] = useState(today.getFullYear())
  const [cursorMonth, setCursorMonth] = useState(today.getMonth())
  const [showComposer, setShowComposer] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['hr-calendar-users'],
    queryFn: () => listFirestoreUsers({ status: 'Active' }),
    staleTime: 60_000,
    enabled: Boolean(token),
  })

  const kindForView: HRCalendarKind | undefined =
    view === 'todos' ? 'todo' : view === 'reminders' ? 'reminder' : undefined

  const entriesQuery = useQuery({
    queryKey: ['hr-calendar-entries', view, monthKey(cursorYear, cursorMonth)],
    queryFn: () => listHRCalendarEntries({ kind: kindForView }),
    enabled: Boolean(token),
    refetchOnWindowFocus: false,
  })

  const completeMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      updateHRCalendarEntryStatus(id, done ? 'done' : 'open'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hr-calendar-entries'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => softDeleteHRCalendarEntry(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hr-calendar-entries'] })
      setFeedback('Entry removed.')
    },
  })

  const entries = entriesQuery.data ?? []

  const entriesByDate = useMemo(() => {
    const map = new Map<string, HRCalendarEntry[]>()
    entries.forEach((entry) => {
      const dateKey = entry.startsAt.slice(0, 10)
      const bucket = map.get(dateKey) ?? []
      bucket.push(entry)
      map.set(dateKey, bucket)
    })
    return map
  }, [entries])

  const title =
    view === 'todos' ? 'HR To-do List' : view === 'reminders' ? 'HR Reminders' : 'HR Calendar'
  const subtitle =
    view === 'todos'
      ? 'Tasks and follow-ups for the HR team.'
      : view === 'reminders'
        ? 'Time-boxed alerts the HR team should not miss.'
        : 'Compliance dates, interviews, leave, joining and exit events.'

  return (
    <ModulePageLayout
      moduleTab="HRCalendar"
      title={title}
      subtitle={subtitle}
      breadcrumbs={['Pipeline', 'HR', title]}
      subnav={subnav}
      subnavActions={
        <button
          type="button"
          onClick={() => setShowComposer(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" /> New{' '}
          {view === 'todos' ? 'to-do' : view === 'reminders' ? 'reminder' : 'event'}
        </button>
      }
    >
      {error ? (
        <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {feedback}
        </p>
      ) : null}

      {view === 'calendar' ? (
        <CalendarGrid
          year={cursorYear}
          month={cursorMonth}
          entriesByDate={entriesByDate}
          onShift={(delta) => {
            const next = new Date(cursorYear, cursorMonth + delta, 1)
            setCursorYear(next.getFullYear())
            setCursorMonth(next.getMonth())
          }}
        />
      ) : (
        <EntriesList
          entries={entries}
          loading={entriesQuery.isLoading}
          onToggleDone={(entry) =>
            completeMutation.mutate({ id: entry.id, done: entry.status !== 'done' })
          }
          onDelete={(id) => deleteMutation.mutate(id)}
          view={view}
        />
      )}

      {showComposer ? (
        <ComposerDialog
          users={usersQuery.data ?? []}
          kind={
            view === 'todos' ? 'todo' : view === 'reminders' ? 'reminder' : 'event'
          }
          token={token}
          onClose={() => setShowComposer(false)}
          onError={(message) => setError(message)}
          onSuccess={() => {
            setShowComposer(false)
            setFeedback('Entry saved.')
            void queryClient.invalidateQueries({ queryKey: ['hr-calendar-entries'] })
          }}
        />
      ) : null}
    </ModulePageLayout>
  )
}

const CalendarGrid = ({
  year,
  month,
  entriesByDate,
  onShift,
}: {
  year: number
  month: number
  entriesByDate: Map<string, HRCalendarEntry[]>
  onShift: (delta: number) => void
}) => {
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDow = firstDay.getDay()
  const cells: Array<{ date: number; iso: string } | null> = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let date = 1; date <= daysInMonth; date++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`
    cells.push({ date, iso })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const monthName = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const todayKey = todayIso()

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onShift(-1)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          ← Prev
        </button>
        <div className="text-lg font-semibold text-foreground">{monthName}</div>
        <button
          type="button"
          onClick={() => onShift(1)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          Next →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs uppercase tracking-wide text-muted">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
          <div key={label} className="px-2 py-1.5 text-center">
            {label}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell, index) => {
          if (!cell) {
            return <div key={`empty-${index}`} className="min-h-24 rounded-md" />
          }
          const entries = entriesByDate.get(cell.iso) ?? []
          const isToday = cell.iso === todayKey
          return (
            <div
              key={cell.iso}
              className={`min-h-24 rounded-md border p-2 ${
                isToday
                  ? 'border-accent/60 bg-accent/5'
                  : 'border-border/60 bg-base/30'
              }`}
            >
              <div
                className={`text-xs font-medium tabular-nums ${
                  isToday ? 'text-accent' : 'text-foreground'
                }`}
              >
                {cell.date}
              </div>
              <div className="mt-1 space-y-1">
                {entries.slice(0, 3).map((entry) => (
                  <div
                    key={entry.id}
                    className="truncate rounded px-1 py-0.5 text-[11px] text-foreground"
                    style={{ backgroundColor: 'rgb(var(--color-accent) / 0.12)' }}
                    title={entry.title}
                  >
                    {entry.kind === 'reminder' ? '🔔 ' : entry.kind === 'todo' ? '☐ ' : '📍 '}
                    {entry.title}
                  </div>
                ))}
                {entries.length > 3 ? (
                  <div className="text-[11px] text-muted">+{entries.length - 3} more</div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const EntriesList = ({
  entries,
  loading,
  onToggleDone,
  onDelete,
  view,
}: {
  entries: HRCalendarEntry[]
  loading: boolean
  onToggleDone: (entry: HRCalendarEntry) => void
  onDelete: (id: string) => void
  view: HRCalendarView
}) => {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        title={view === 'todos' ? 'No to-dos yet' : 'Nothing scheduled'}
        description="Click the New button to add the first entry."
        icon={view === 'reminders' ? <Bell className="h-8 w-8" /> : <CalendarIcon className="h-8 w-8" />}
      />
    )
  }
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex items-start justify-between gap-3 rounded-xl border border-border bg-panel p-3 ${
            entry.status === 'done' ? 'opacity-60' : ''
          }`}
        >
          <div className="flex items-start gap-3">
            {view === 'todos' ? (
              <button
                type="button"
                onClick={() => onToggleDone(entry)}
                className={`mt-1 flex h-5 w-5 items-center justify-center rounded border ${
                  entry.status === 'done'
                    ? 'border-success bg-success/20 text-success'
                    : 'border-border text-transparent hover:border-accent'
                }`}
                aria-label="Toggle done"
              >
                {entry.status === 'done' ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ) : (
              <div
                className={`mt-1 flex h-5 w-5 items-center justify-center rounded border border-border ${
                  view === 'reminders' ? 'text-accent' : 'text-muted'
                }`}
              >
                {view === 'reminders' ? (
                  <Bell className="h-3 w-3" />
                ) : (
                  <CalendarIcon className="h-3 w-3" />
                )}
              </div>
            )}
            <div>
              <div
                className={`font-medium text-foreground ${
                  entry.status === 'done' ? 'line-through' : ''
                }`}
              >
                {entry.title}
              </div>
              {entry.description ? (
                <div className="mt-0.5 text-sm text-muted">{entry.description}</div>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                <span className="tabular-nums">{fmtDateTimeFullIST(entry.startsAt)}</span>
                {entry.assignedToName ? <span>· {entry.assignedToName}</span> : null}
                {entry.recurrence && entry.recurrence !== 'none' ? (
                  <span>· repeats {entry.recurrence}</span>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(entry.id)}
            className="rounded-md border border-border p-1 text-critical hover:bg-critical/10"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

const ComposerDialog = ({
  users,
  kind,
  token,
  onClose,
  onError,
  onSuccess,
}: {
  users: { id: string; name: string; role: string }[]
  kind: HRCalendarKind
  token: string
  onClose: () => void
  onError: (message: string) => void
  onSuccess: () => void
}) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState(() => {
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  })
  const [assignedTo, setAssignedTo] = useState('')
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none')
  const [reminderMinutes, setReminderMinutes] = useState<number | ''>(
    kind === 'reminder' ? 30 : '',
  )
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) {
      onError('Title is required.')
      return
    }
    setSubmitting(true)
    try {
      const assignee = users.find((user) => user.id === assignedTo)
      await createHRCalendarEntry(token, {
        kind,
        title: title.trim(),
        description: description.trim() || undefined,
        startsAt: new Date(startsAt).toISOString(),
        assignedTo: assignee?.id,
        assignedToName: assignee?.name,
        recurrence,
        reminderMinutesBefore:
          reminderMinutes === '' ? undefined : Math.max(0, Number(reminderMinutes)),
      })
      onSuccess()
    } catch (err) {
      logger.error(
        'hr-calendar.create-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      onError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 backdrop-blur-sm px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-panel p-6"
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-foreground">
            New {kind === 'todo' ? 'to-do' : kind === 'reminder' ? 'reminder' : 'event'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <FormRow label="Title">
          <input
            className="ui-field min-h-10 w-full"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </FormRow>
        <FormRow label="Description (optional)">
          <textarea
            className="ui-field min-h-20 w-full"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </FormRow>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="When">
            <input
              type="datetime-local"
              className="ui-field min-h-10 w-full"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Assign to (optional)">
            <select
              className="ui-field min-h-10 w-full"
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.role}
                </option>
              ))}
            </select>
          </FormRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Repeats">
            <select
              className="ui-field min-h-10 w-full"
              value={recurrence}
              onChange={(event) =>
                setRecurrence(event.target.value as 'none' | 'daily' | 'weekly' | 'monthly')
              }
            >
              <option value="none">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </FormRow>
          <FormRow label="Remind me before (min)">
            <input
              type="number"
              min={0}
              className="ui-field min-h-10 w-full"
              value={reminderMinutes}
              onChange={(event) =>
                setReminderMinutes(event.target.value === '' ? '' : Number(event.target.value))
              }
              placeholder="0"
            />
          </FormRow>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

const FormRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-sm">
    <span className="mb-1 block text-xs uppercase tracking-wide text-muted">{label}</span>
    {children}
  </label>
)

export default HRCalendarModule
