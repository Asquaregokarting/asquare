import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus, Star, X } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { FilterBar, FilterField } from '../../../components/ui/FilterBar'
import EmptyState from '../../../../components/ui/EmptyState'
import Skeleton from '../../../../components/ui/Skeleton'
import {
  createHRAppraisal,
  getHRAppraisal,
  listHRAppraisals,
  updateHRAppraisalStage,
} from '../../../api/hr-appraisals-firestore'
import { listFirestoreUsers } from '../../../api/users-firestore'
import {
  AppraisalRating,
  AppraisalStage,
  HRAppraisal,
  Role,
} from '../../../api/types'
import { logger } from '../../../../lib/logger'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'

export type AppraisalsView = 'list' | 'detail'

const STAGE_LABELS: Record<AppraisalStage, string> = {
  self: 'Self-assessment',
  manager: 'Manager review',
  hr: 'HR sign-off',
  closed: 'Closed',
}

const STAGE_TONES: Record<AppraisalStage, string> = {
  self: 'bg-base/40 text-muted',
  manager: 'bg-accent/15 text-accent',
  hr: 'bg-warning/10 text-warning',
  closed: 'bg-success/10 text-success',
}

const HRAppraisalsModule = ({ view }: { view: AppraisalsView }) => {
  const { appraisalId } = useParams<{ appraisalId?: string }>()
  if (view === 'detail') {
    if (!appraisalId) return <Navigate replace to="/hr/appraisals" />
    return <AppraisalDetail appraisalId={appraisalId} />
  }
  return <AppraisalsList />
}

const defaultCycle = (): string => {
  const now = new Date()
  const month = now.getMonth() + 1
  const quarter = Math.ceil(month / 3)
  return `Q${quarter} ${now.getFullYear()}`
}

const AppraisalsList = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const queryClient = useQueryClient()
  const [cycleFilter, setCycleFilter] = useState('')
  const [stageFilter, setStageFilter] = useState<AppraisalStage | ''>('')
  const [showComposer, setShowComposer] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const appraisalsQuery = useQuery({
    queryKey: ['hr-appraisals', cycleFilter, stageFilter],
    queryFn: () =>
      listHRAppraisals({
        cycleLabel: cycleFilter || undefined,
        stage: stageFilter || undefined,
      }),
    enabled: Boolean(token),
    refetchOnWindowFocus: false,
  })

  const usersQuery = useQuery({
    queryKey: ['hr-appraisal-users'],
    queryFn: () => listFirestoreUsers({ status: 'Active' }),
    staleTime: 60_000,
    enabled: Boolean(token),
  })

  const appraisals = appraisalsQuery.data ?? []
  const cycles = useMemo(() => {
    const set = new Set<string>()
    appraisals.forEach((appraisal) => {
      if (appraisal.cycleLabel) set.add(appraisal.cycleLabel)
    })
    return Array.from(set).sort().reverse()
  }, [appraisals])

  const summary = useMemo(() => {
    let self = 0
    let manager = 0
    let hr = 0
    let closed = 0
    appraisals.forEach((appraisal) => {
      if (appraisal.stage === 'self') self += 1
      if (appraisal.stage === 'manager') manager += 1
      if (appraisal.stage === 'hr') hr += 1
      if (appraisal.stage === 'closed') closed += 1
    })
    return { self, manager, hr, closed }
  }, [appraisals])

  return (
    <ModulePageLayout
      moduleTab="Appraisals"
      title="Performance Reviews"
      subtitle="Quarterly cycles with self-assessment, manager review and HR sign-off."
      breadcrumbs={['Pipeline', 'HR', 'Appraisals']}
      subnavActions={
        <button
          type="button"
          onClick={() => setShowComposer(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" /> Start appraisal
        </button>
      }
    >
      {feedback ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {feedback}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Awaiting self" value={String(summary.self)} />
        <SummaryCard label="Manager review" value={String(summary.manager)} tone="accent" />
        <SummaryCard label="HR sign-off" value={String(summary.hr)} tone="warning" />
        <SummaryCard label="Closed" value={String(summary.closed)} tone="success" />
      </div>

      <FilterBar>
        <FilterField label="Cycle">
          <select
            className="ui-field min-h-10"
            value={cycleFilter}
            onChange={(event) => setCycleFilter(event.target.value)}
          >
            <option value="">All cycles</option>
            {cycles.map((cycle) => (
              <option key={cycle} value={cycle}>
                {cycle}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Stage">
          <select
            className="ui-field min-h-10"
            value={stageFilter}
            onChange={(event) =>
              setStageFilter(event.target.value as AppraisalStage | '')
            }
          >
            <option value="">All stages</option>
            <option value="self">Awaiting self</option>
            <option value="manager">Manager review</option>
            <option value="hr">HR sign-off</option>
            <option value="closed">Closed</option>
          </select>
        </FilterField>
      </FilterBar>

      <div className="mt-4">
        {appraisalsQuery.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : appraisals.length === 0 ? (
          <EmptyState
            title="No appraisals yet"
            description="Start the first appraisal to open a new review cycle."
            icon={<Star className="h-8 w-8" />}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-base/40 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Cycle</th>
                  <th className="px-4 py-2.5">Stage</th>
                  <th className="px-4 py-2.5 text-right">Self</th>
                  <th className="px-4 py-2.5 text-right">Manager</th>
                  <th className="px-4 py-2.5 text-right">Final</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {appraisals.map((appraisal) => (
                  <tr key={appraisal.id} className="hover:bg-base/40">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <a
                        href={`/hr/appraisals/${appraisal.id}`}
                        className="hover:underline"
                      >
                        {appraisal.employeeName}
                      </a>
                      <div className="text-xs text-muted">{appraisal.employeeRole}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{appraisal.cycleLabel}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          STAGE_TONES[appraisal.stage]
                        }`}
                      >
                        {STAGE_LABELS[appraisal.stage]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {appraisal.selfRating ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {appraisal.managerRating ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {appraisal.finalRating ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/hr/appraisals/${appraisal.id}`}
                        className="inline-flex items-center text-sm text-muted hover:text-foreground"
                      >
                        Open <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showComposer ? (
        <NewAppraisalDialog
          token={token}
          users={usersQuery.data ?? []}
          defaultCycle={defaultCycle()}
          onClose={() => setShowComposer(false)}
          onSuccess={() => {
            setShowComposer(false)
            setFeedback('Appraisal opened.')
            void queryClient.invalidateQueries({ queryKey: ['hr-appraisals'] })
          }}
        />
      ) : null}
    </ModulePageLayout>
  )
}

const AppraisalDetail = ({ appraisalId }: { appraisalId: string }) => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<string | null>(null)

  const appraisalQuery = useQuery({
    queryKey: ['hr-appraisal-detail', appraisalId],
    queryFn: () => getHRAppraisal(appraisalId),
    enabled: Boolean(token),
  })
  const appraisal = appraisalQuery.data
  const [selfRating, setSelfRating] = useState<number | ''>('')
  const [selfSummary, setSelfSummary] = useState('')
  const [managerRating, setManagerRating] = useState<number | ''>('')
  const [managerSummary, setManagerSummary] = useState('')
  const [finalRating, setFinalRating] = useState<number | ''>('')
  const [finalSummary, setFinalSummary] = useState('')

  useMemo(() => {
    if (appraisal) {
      setSelfRating(appraisal.selfRating ?? '')
      setSelfSummary(appraisal.selfSummary ?? '')
      setManagerRating(appraisal.managerRating ?? '')
      setManagerSummary(appraisal.managerSummary ?? '')
      setFinalRating(appraisal.finalRating ?? '')
      setFinalSummary(appraisal.finalSummary ?? '')
    }
  }, [appraisal])

  const advanceMutation = useMutation({
    mutationFn: (next: AppraisalStage) =>
      updateHRAppraisalStage(token, appraisalId, {
        stage: next,
        selfRating:
          selfRating === '' ? undefined : (Number(selfRating) as AppraisalRating),
        selfSummary,
        managerRating:
          managerRating === '' ? undefined : (Number(managerRating) as AppraisalRating),
        managerSummary,
        finalRating:
          finalRating === '' ? undefined : (Number(finalRating) as AppraisalRating),
        finalSummary,
      }),
    onSuccess: () => {
      setFeedback('Appraisal updated.')
      void queryClient.invalidateQueries({ queryKey: ['hr-appraisal-detail', appraisalId] })
      void queryClient.invalidateQueries({ queryKey: ['hr-appraisals'] })
    },
    onError: (err: unknown) => {
      logger.error(
        'hr-appraisal.advance-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
    },
  })

  if (appraisalQuery.isLoading) {
    return (
      <ModulePageLayout
        moduleTab="Appraisals"
        title="Appraisal"
        subtitle="Loading…"
        breadcrumbs={['Pipeline', 'HR', 'Appraisals', '…']}
      >
        <Skeleton className="h-40 w-full" />
      </ModulePageLayout>
    )
  }

  if (!appraisal) {
    return (
      <ModulePageLayout
        moduleTab="Appraisals"
        title="Appraisal"
        subtitle="Not found"
        breadcrumbs={['Pipeline', 'HR', 'Appraisals', 'Not found']}
      >
        <EmptyState
          title="Appraisal not found"
          description="It may have been removed."
          icon={<Star className="h-8 w-8" />}
        />
      </ModulePageLayout>
    )
  }

  return (
    <ModulePageLayout
      moduleTab="Appraisals"
      title={`${appraisal.employeeName} — ${appraisal.cycleLabel}`}
      subtitle={`Stage: ${STAGE_LABELS[appraisal.stage]}`}
      breadcrumbs={['Pipeline', 'HR', 'Appraisals', appraisal.employeeName]}
    >
      {feedback ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {feedback}
        </p>
      ) : null}

      <StageBar appraisal={appraisal} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <StageCard
          title="Self-assessment"
          active={appraisal.stage === 'self'}
          completed={['manager', 'hr', 'closed'].includes(appraisal.stage)}
          submittedAt={appraisal.selfSubmittedAt}
        >
          <RatingInput
            value={selfRating}
            onChange={setSelfRating}
            disabled={appraisal.stage !== 'self'}
          />
          <textarea
            className="ui-field mt-2 min-h-24 w-full text-sm"
            placeholder="What went well, what to improve…"
            value={selfSummary}
            onChange={(event) => setSelfSummary(event.target.value)}
            disabled={appraisal.stage !== 'self'}
          />
          {appraisal.stage === 'self' ? (
            <button
              type="button"
              onClick={() => advanceMutation.mutate('manager')}
              disabled={advanceMutation.isPending}
              className="mt-3 w-full rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              Submit to manager
            </button>
          ) : null}
        </StageCard>

        <StageCard
          title="Manager review"
          active={appraisal.stage === 'manager'}
          completed={['hr', 'closed'].includes(appraisal.stage)}
          submittedAt={appraisal.managerSubmittedAt}
        >
          <RatingInput
            value={managerRating}
            onChange={setManagerRating}
            disabled={appraisal.stage !== 'manager'}
          />
          <textarea
            className="ui-field mt-2 min-h-24 w-full text-sm"
            placeholder="Manager comments…"
            value={managerSummary}
            onChange={(event) => setManagerSummary(event.target.value)}
            disabled={appraisal.stage !== 'manager'}
          />
          {appraisal.stage === 'manager' ? (
            <button
              type="button"
              onClick={() => advanceMutation.mutate('hr')}
              disabled={advanceMutation.isPending}
              className="mt-3 w-full rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              Send to HR
            </button>
          ) : null}
        </StageCard>

        <StageCard
          title="HR sign-off"
          active={appraisal.stage === 'hr'}
          completed={appraisal.stage === 'closed'}
          submittedAt={appraisal.hrSignedOffAt}
        >
          <RatingInput
            value={finalRating}
            onChange={setFinalRating}
            disabled={appraisal.stage !== 'hr'}
          />
          <textarea
            className="ui-field mt-2 min-h-24 w-full text-sm"
            placeholder="Final summary, salary action, etc."
            value={finalSummary}
            onChange={(event) => setFinalSummary(event.target.value)}
            disabled={appraisal.stage !== 'hr'}
          />
          {appraisal.stage === 'hr' ? (
            <button
              type="button"
              onClick={() => advanceMutation.mutate('closed')}
              disabled={advanceMutation.isPending}
              className="mt-3 w-full rounded-lg border border-border bg-success px-3 py-1.5 text-sm font-medium text-success-foreground hover:bg-success/90 disabled:opacity-60"
            >
              Close appraisal
            </button>
          ) : null}
        </StageCard>
      </div>
    </ModulePageLayout>
  )
}

const StageBar = ({ appraisal }: { appraisal: HRAppraisal }) => {
  const stages: AppraisalStage[] = ['self', 'manager', 'hr', 'closed']
  const idx = stages.indexOf(appraisal.stage)
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-panel p-3 text-xs">
      {stages.map((stage, index) => (
        <div key={stage} className="flex flex-1 items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
              index <= idx
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-muted'
            }`}
          >
            {index + 1}
          </div>
          <div className={`truncate ${index <= idx ? 'text-foreground' : 'text-muted'}`}>
            {STAGE_LABELS[stage]}
          </div>
          {index < stages.length - 1 ? (
            <div
              className={`h-px flex-1 ${
                index < idx ? 'bg-accent/50' : 'bg-border'
              }`}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

const StageCard = ({
  title,
  active,
  completed,
  submittedAt,
  children,
}: {
  title: string
  active: boolean
  completed: boolean
  submittedAt?: string
  children: React.ReactNode
}) => (
  <div
    className={`rounded-xl border p-4 ${
      active
        ? 'border-accent/60 bg-accent/5'
        : completed
          ? 'border-success/30 bg-success/5'
          : 'border-border bg-panel'
    }`}
  >
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {submittedAt ? (
        <span className="text-xs text-muted tabular-nums">
          {fmtDateTimeFullIST(submittedAt)}
        </span>
      ) : null}
    </div>
    {children}
  </div>
)

const RatingInput = ({
  value,
  onChange,
  disabled,
}: {
  value: number | ''
  onChange: (value: number | '') => void
  disabled: boolean
}) => (
  <div className="flex items-center gap-1">
    {[1, 2, 3, 4, 5].map((star) => (
      <button
        key={star}
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === star ? '' : star)}
        className={`text-xl transition-colors ${
          (typeof value === 'number' ? value : 0) >= star
            ? 'text-warning'
            : 'text-muted/40 hover:text-muted'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        aria-label={`${star} of 5`}
      >
        ★
      </button>
    ))}
  </div>
)

const SummaryCard = ({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'accent' | 'warning' | 'success'
}) => (
  <div className="rounded-xl border border-border bg-panel p-4">
    <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    <div
      className={`mt-1 text-2xl font-semibold tabular-nums ${
        tone === 'accent'
          ? 'text-accent'
          : tone === 'warning'
            ? 'text-warning'
            : tone === 'success'
              ? 'text-success'
              : 'text-foreground'
      }`}
    >
      {value}
    </div>
  </div>
)

const NewAppraisalDialog = ({
  users,
  token,
  defaultCycle,
  onClose,
  onSuccess,
}: {
  users: { id: string; name: string; role: Role }[]
  token: string
  defaultCycle: string
  onClose: () => void
  onSuccess: () => void
}) => {
  const [cycleLabel, setCycleLabel] = useState(defaultCycle)
  const [employeeId, setEmployeeId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const employee = users.find((user) => user.id === employeeId)
    if (!employee) {
      setError('Pick an employee.')
      return
    }
    setSubmitting(true)
    try {
      const manager = users.find((user) => user.id === managerId)
      await createHRAppraisal(token, {
        cycleLabel: cycleLabel.trim() || defaultCycle,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeRole: employee.role,
        managerId: manager?.id,
        managerName: manager?.name,
      })
      onSuccess()
    } catch (err) {
      logger.error(
        'hr-appraisal.create-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      setError(err instanceof Error ? err.message : 'Failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 backdrop-blur-sm px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-panel p-6"
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-foreground">Start appraisal</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {error ? (
          <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        ) : null}
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Cycle</span>
          <input
            className="ui-field min-h-10 w-full"
            value={cycleLabel}
            onChange={(event) => setCycleLabel(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Employee</span>
          <select
            className="ui-field min-h-10 w-full"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            required
          >
            <option value="">Select…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
            Reporting manager (optional)
          </span>
          <select
            className="ui-field min-h-10 w-full"
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
          >
            <option value="">None</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role}
              </option>
            ))}
          </select>
        </label>
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
            className="rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? 'Opening…' : 'Open appraisal'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default HRAppraisalsModule
