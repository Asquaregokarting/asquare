import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  Download,
  Plus,
  Receipt,
  Send,
  Wallet,
  X,
} from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { FilterBar, FilterField } from '../../../components/ui/FilterBar'
import EmptyState from '../../../../components/ui/EmptyState'
import Skeleton from '../../../../components/ui/Skeleton'
import {
  createPayrollRun,
  getPayrollRun,
  listPayrollRuns,
  listPayrollSlips,
  updatePayrollRunStatus,
  upsertPayrollSlip,
} from '../../../api/hr-payroll-firestore'
import { listFirestoreUsers } from '../../../api/users-firestore'
import { getHREmployeeProfile } from '../../../api/hr-employee-firestore'
import { listCashierIncentives } from '../../../api/incentives-firestore'
import { listFirestoreShifts } from '../../../api/shifts-firestore'
import {
  HRPayrollRun,
  HRPayrollSlip,
  PayrollRunStatus,
  Role,
} from '../../../api/types'
import { logger } from '../../../../lib/logger'

export type PayrollView = 'runs' | 'runDetail' | 'slipDetail'

const STATUS_TONES: Record<PayrollRunStatus, string> = {
  draft: 'bg-base/40 text-muted',
  review: 'bg-warning/10 text-warning',
  approved: 'bg-accent/15 text-accent',
  paid: 'bg-success/10 text-success',
  cancelled: 'bg-critical/10 text-critical',
}

const formatINR = (amount: number): string =>
  `₹${Math.round(amount).toLocaleString('en-IN')}`

const HRPayrollModule = ({ view }: { view: PayrollView }) => {
  const { runId, slipId } = useParams<{ runId?: string; slipId?: string }>()
  if (view === 'runDetail') {
    if (!runId) return <Navigate replace to="/hr/payroll" />
    return <PayrollRunDetail runId={runId} />
  }
  if (view === 'slipDetail') {
    if (!slipId) return <Navigate replace to="/hr/payroll" />
    return <PayrollSlipDetail slipId={slipId} />
  }
  return <PayrollRunsList />
}

const PayrollRunsList = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<PayrollRunStatus | ''>('')
  const [showComposer, setShowComposer] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const runsQuery = useQuery({
    queryKey: ['hr-payroll-runs', statusFilter],
    queryFn: () => listPayrollRuns({ status: statusFilter || undefined }),
    enabled: Boolean(token),
    refetchOnWindowFocus: false,
  })

  const runs = runsQuery.data ?? []

  const summary = useMemo(() => {
    return runs.reduce(
      (acc, run) => {
        acc.totalGross += run.totalGross
        acc.totalDeductions += run.totalDeductions
        acc.totalNet += run.totalNet
        acc.totalLopDays += run.totalLopDays
        return acc
      },
      { totalGross: 0, totalDeductions: 0, totalNet: 0, totalLopDays: 0 },
    )
  }, [runs])

  return (
    <ModulePageLayout
      moduleTab="Payroll"
      title="Payroll"
      subtitle="Monthly payroll runs with LOP, deductions and incentives."
      breadcrumbs={['Pipeline', 'HR', 'Payroll']}
      subnavActions={
        <button
          type="button"
          onClick={() => setShowComposer(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" /> New run
        </button>
      }
    >
      {feedback ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {feedback}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Gross (filtered)" value={formatINR(summary.totalGross)} />
        <SummaryCard
          label="Deductions"
          value={formatINR(summary.totalDeductions)}
          tone="warning"
        />
        <SummaryCard label="Net" value={formatINR(summary.totalNet)} tone="success" />
        <SummaryCard label="LOP days" value={String(summary.totalLopDays)} />
      </div>

      <FilterBar>
        <FilterField label="Status">
          <select
            className="ui-field min-h-10"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as PayrollRunStatus | '')
            }
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </FilterField>
      </FilterBar>

      <div className="mt-4">
        {runsQuery.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            title="No payroll runs yet"
            description="Click New run to start the first monthly cycle."
            icon={<Wallet className="h-8 w-8" />}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-base/40 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5">Month</th>
                  <th className="px-4 py-2.5">Label</th>
                  <th className="px-4 py-2.5 text-right">Employees</th>
                  <th className="px-4 py-2.5 text-right">Gross</th>
                  <th className="px-4 py-2.5 text-right">Net</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-base/40">
                    <td className="px-4 py-3 font-medium text-foreground tabular-nums">
                      <a
                        href={`/hr/payroll/runs/${run.id}`}
                        className="hover:underline"
                      >
                        {run.monthIso}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-muted">{run.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {run.totalEmployees}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatINR(run.totalGross)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">
                      {formatINR(run.totalNet)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          STATUS_TONES[run.status]
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/hr/payroll/runs/${run.id}`}
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
        <NewRunDialog
          token={token}
          onClose={() => setShowComposer(false)}
          onSuccess={() => {
            setShowComposer(false)
            setFeedback('Payroll run created.')
            void queryClient.invalidateQueries({ queryKey: ['hr-payroll-runs'] })
          }}
        />
      ) : null}
    </ModulePageLayout>
  )
}

const PayrollRunDetail = ({ runId }: { runId: string }) => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const queryClient = useQueryClient()
  const [showSlipEditor, setShowSlipEditor] = useState(false)
  const [editingSlip, setEditingSlip] = useState<HRPayrollSlip | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const runQuery = useQuery({
    queryKey: ['hr-payroll-run', runId],
    queryFn: () => getPayrollRun(runId),
    enabled: Boolean(token),
  })
  const slipsQuery = useQuery({
    queryKey: ['hr-payroll-slips', runId],
    queryFn: () => listPayrollSlips(runId),
    enabled: Boolean(token),
  })

  const usersQuery = useQuery({
    queryKey: ['hr-payroll-users'],
    queryFn: () => listFirestoreUsers({ status: 'Active' }),
    enabled: Boolean(token),
    staleTime: 60_000,
  })

  const advanceMutation = useMutation({
    mutationFn: (status: PayrollRunStatus) => updatePayrollRunStatus(token, runId, status),
    onSuccess: () => {
      setFeedback('Status updated.')
      void queryClient.invalidateQueries({ queryKey: ['hr-payroll-run', runId] })
      void queryClient.invalidateQueries({ queryKey: ['hr-payroll-slips', runId] })
      void queryClient.invalidateQueries({ queryKey: ['hr-payroll-runs'] })
    },
    onError: (err: unknown) => {
      logger.error(
        'hr-payroll.status-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
    },
  })

  const run = runQuery.data
  const slips = slipsQuery.data ?? []

  if (runQuery.isLoading) {
    return (
      <ModulePageLayout
        moduleTab="Payroll"
        title="Payroll run"
        subtitle="Loading…"
        breadcrumbs={['Pipeline', 'HR', 'Payroll', '…']}
      >
        <Skeleton className="h-40 w-full" />
      </ModulePageLayout>
    )
  }

  if (!run) {
    return (
      <ModulePageLayout
        moduleTab="Payroll"
        title="Run not found"
        subtitle="It may have been removed."
        breadcrumbs={['Pipeline', 'HR', 'Payroll', 'Not found']}
      >
        <EmptyState
          title="Payroll run not found"
          description="Go back to runs."
          icon={<Wallet className="h-8 w-8" />}
        />
      </ModulePageLayout>
    )
  }

  const exportCsv = () => {
    const headers = [
      'Employee',
      'Role',
      'Base',
      'Working',
      'Present',
      'LOP',
      'OT hrs',
      'Incentive',
      'Gross',
      'Deductions',
      'Net',
    ]
    const rows = slips.map((slip) => [
      slip.employeeName,
      slip.employeeRole,
      slip.baseSalary,
      slip.workingDays,
      slip.presentDays,
      slip.lopDays,
      slip.overtimeHours,
      slip.incentiveAmount,
      slip.grossPay,
      slip.totalDeductions,
      slip.netPay,
    ])
    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `payroll-${run.monthIso}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <ModulePageLayout
      moduleTab="Payroll"
      title={`Payroll ${run.monthIso}`}
      subtitle={run.label}
      breadcrumbs={['Pipeline', 'HR', 'Payroll', run.monthIso]}
      subnavActions={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingSlip(null)
              setShowSlipEditor(true)
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" /> Add slip
          </button>
        </div>
      }
    >
      {feedback ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {feedback}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label="Employees" value={String(run.totalEmployees)} />
        <SummaryCard label="Gross" value={formatINR(run.totalGross)} />
        <SummaryCard
          label="Deductions"
          value={formatINR(run.totalDeductions)}
          tone="warning"
        />
        <SummaryCard label="Net" value={formatINR(run.totalNet)} tone="success" />
        <SummaryCard label="LOP days" value={String(run.totalLopDays)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted">Status</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
            STATUS_TONES[run.status]
          }`}
        >
          {run.status}
        </span>
        {run.status === 'draft' ? (
          <button
            type="button"
            onClick={() => advanceMutation.mutate('review')}
            className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-foreground"
          >
            Send to review
          </button>
        ) : null}
        {run.status === 'review' ? (
          <button
            type="button"
            onClick={() => advanceMutation.mutate('approved')}
            className="rounded-lg border border-accent/60 bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25"
          >
            Approve
          </button>
        ) : null}
        {run.status === 'approved' ? (
          <button
            type="button"
            onClick={() => advanceMutation.mutate('paid')}
            className="inline-flex items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-3 py-1 text-xs text-success hover:bg-success/20"
          >
            <Send className="h-3 w-3" /> Mark paid
          </button>
        ) : null}
      </div>

      {slipsQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : slips.length === 0 ? (
        <EmptyState
          title="No slips yet"
          description="Add the first slip to populate this run."
          icon={<Receipt className="h-8 w-8" />}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-base/40 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5 text-right">Base</th>
                <th className="px-4 py-2.5 text-right">LOP</th>
                <th className="px-4 py-2.5 text-right">Incentive</th>
                <th className="px-4 py-2.5 text-right">Gross</th>
                <th className="px-4 py-2.5 text-right">Deductions</th>
                <th className="px-4 py-2.5 text-right">Net</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {slips.map((slip) => (
                <tr key={slip.id} className="hover:bg-base/40">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {slip.employeeName}
                    <div className="text-xs text-muted">{slip.employeeRole}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatINR(slip.baseSalary)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-warning">
                    {slip.lopDays}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatINR(slip.incentiveAmount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatINR(slip.grossPay)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-critical">
                    {formatINR(slip.totalDeductions)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-success">
                    {formatINR(slip.netPay)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSlip(slip)
                        setShowSlipEditor(true)
                      }}
                      className="text-xs text-muted hover:text-foreground"
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

      {showSlipEditor ? (
        <SlipEditorDialog
          run={run}
          users={usersQuery.data ?? []}
          slip={editingSlip}
          token={token}
          onClose={() => setShowSlipEditor(false)}
          onSuccess={() => {
            setShowSlipEditor(false)
            setFeedback('Slip saved.')
            void queryClient.invalidateQueries({ queryKey: ['hr-payroll-slips', runId] })
            void queryClient.invalidateQueries({ queryKey: ['hr-payroll-run', runId] })
            void queryClient.invalidateQueries({ queryKey: ['hr-payroll-runs'] })
          }}
        />
      ) : null}
    </ModulePageLayout>
  )
}

const PayrollSlipDetail = ({ slipId }: { slipId: string }) => (
  <ModulePageLayout
    moduleTab="Payroll"
    title="Slip"
    subtitle={`#${slipId}`}
    breadcrumbs={['Pipeline', 'HR', 'Payroll', 'Slip']}
  >
    <EmptyState
      title="Slip view coming soon"
      description="For now, view slips from the run page."
      icon={<Receipt className="h-8 w-8" />}
    />
  </ModulePageLayout>
)

const NewRunDialog = ({
  token,
  onClose,
  onSuccess,
}: {
  token: string
  onClose: () => void
  onSuccess: () => void
}) => {
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [monthIso, setMonthIso] = useState(defaultMonth)
  const [label, setLabel] = useState(
    now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createPayrollRun(token, {
        monthIso,
        label: label.trim() || monthIso,
      })
      onSuccess()
    } catch (err) {
      logger.error(
        'hr-payroll.create-failed',
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
          <h3 className="text-lg font-semibold text-foreground">New payroll run</h3>
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
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Month</span>
          <input
            type="month"
            className="ui-field min-h-10 w-full"
            value={monthIso}
            onChange={(event) => setMonthIso(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Label</span>
          <input
            className="ui-field min-h-10 w-full"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
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
            {submitting ? 'Creating…' : 'Create run'}
          </button>
        </div>
      </form>
    </div>
  )
}

const SlipEditorDialog = ({
  run,
  users,
  slip,
  token,
  onClose,
  onSuccess,
}: {
  run: HRPayrollRun
  users: { id: string; name: string; role: Role; branchId?: string }[]
  slip: HRPayrollSlip | null
  token: string
  onClose: () => void
  onSuccess: () => void
}) => {
  const [employeeId, setEmployeeId] = useState(slip?.employeeId ?? '')
  const [baseSalary, setBaseSalary] = useState(String(slip?.baseSalary ?? ''))
  const [workingDays, setWorkingDays] = useState(String(slip?.workingDays ?? 30))
  const [presentDays, setPresentDays] = useState(String(slip?.presentDays ?? 30))
  const [overtimeHours, setOvertimeHours] = useState(String(slip?.overtimeHours ?? 0))
  const [incentiveAmount, setIncentiveAmount] = useState(String(slip?.incentiveAmount ?? 0))
  const [tdsAmount, setTdsAmount] = useState('0')
  const [pfAmount, setPfAmount] = useState('0')
  const [esiAmount, setEsiAmount] = useState('0')
  const [advanceAmount, setAdvanceAmount] = useState('0')
  const [notes, setNotes] = useState(slip?.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const employee = users.find((user) => user.id === employeeId)
  const base = Number(baseSalary) || 0
  const working = Math.max(1, Number(workingDays) || 0)
  const present = Math.max(0, Math.min(working, Number(presentDays) || 0))
  const lopDays = working - present
  const lopAmount = Math.round((base / working) * lopDays)
  const incentive = Number(incentiveAmount) || 0
  const otHours = Number(overtimeHours) || 0
  const otPay = Math.round((base / working / 8) * otHours * 1.5)
  const grossPay = base - lopAmount + incentive + otPay
  const deductions =
    (Number(tdsAmount) || 0) +
    (Number(pfAmount) || 0) +
    (Number(esiAmount) || 0) +
    (Number(advanceAmount) || 0)
  const netPay = grossPay - deductions

  const [pulling, setPulling] = useState(false)
  const [pullSummary, setPullSummary] = useState<string | null>(null)

  const loadProfile = async (uid: string) => {
    setEmployeeId(uid)
    setPullSummary(null)
    try {
      const profile = await getHREmployeeProfile(uid)
      if (profile?.baseSalary) {
        setBaseSalary(String(profile.baseSalary))
      }
    } catch (err) {
      logger.warn('hr-payroll.profile-load-failed', {
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Pull canonical month-of-record data: cashier incentives from
  // incentives-firestore and shift attendance from shifts-firestore.
  // Keeps the payroll slip in sync with the data HR / Cashier already
  // see in IncentivesModule and ShiftsModule.
  const pullLiveData = async () => {
    if (!employee) return
    setPulling(true)
    setPullSummary(null)
    try {
      const [yearStr, monthStr] = run.monthIso.split('-')
      const year = Number(yearStr)
      const month = Number(monthStr)
      const fromDate = `${run.monthIso}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const toDate = `${run.monthIso}-${String(lastDay).padStart(2, '0')}`

      let pulledIncentive = 0
      let pulledIncentiveCount = 0
      if (employee.role === 'Cashier') {
        const incentiveRecords = await listCashierIncentives({
          cashierId: employee.id,
          fromDate,
          toDate,
          status: 'active',
        })
        pulledIncentive = incentiveRecords.reduce(
          (sum, record) => sum + (record.incentiveAmount ?? 0),
          0,
        )
        pulledIncentiveCount = incentiveRecords.length
        setIncentiveAmount(String(Math.round(pulledIncentive)))
      }

      const shifts = await listFirestoreShifts(token, {
        userId: employee.id,
        from: fromDate,
        to: toDate,
      })
      const presentDayKeys = new Set(
        shifts
          .map((shift) => (shift.startTime ?? '').slice(0, 10))
          .filter((dateKey) => dateKey),
      )
      if (presentDayKeys.size > 0) {
        setPresentDays(String(presentDayKeys.size))
      }

      setPullSummary(
        `${pulledIncentiveCount} incentive entries (${formatINR(pulledIncentive)}) · ${presentDayKeys.size} shift days`,
      )
    } catch (err) {
      logger.error(
        'hr-payroll.pull-live-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      setError(err instanceof Error ? err.message : 'Failed to pull live data.')
    } finally {
      setPulling(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!employee) {
      setError('Select an employee.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await upsertPayrollSlip(token, {
        id: slip?.id,
        runId: run.id,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeRole: employee.role,
        branchId: employee.branchId,
        monthIso: run.monthIso,
        baseSalary: base,
        workingDays: working,
        presentDays: present,
        lopDays,
        overtimeHours: otHours,
        earnings: [
          { label: 'Basic', amount: base, kind: 'earning' },
          ...(otPay > 0 ? [{ label: 'Overtime', amount: otPay, kind: 'earning' as const }] : []),
          ...(incentive > 0
            ? [{ label: 'Incentive', amount: incentive, kind: 'earning' as const }]
            : []),
          ...(lopAmount > 0
            ? [{ label: 'LOP', amount: -lopAmount, kind: 'earning' as const }]
            : []),
        ],
        deductions: [
          ...(Number(tdsAmount) > 0
            ? [{ label: 'TDS', amount: Number(tdsAmount), kind: 'deduction' as const }]
            : []),
          ...(Number(pfAmount) > 0
            ? [{ label: 'PF', amount: Number(pfAmount), kind: 'deduction' as const }]
            : []),
          ...(Number(esiAmount) > 0
            ? [{ label: 'ESI', amount: Number(esiAmount), kind: 'deduction' as const }]
            : []),
          ...(Number(advanceAmount) > 0
            ? [
                {
                  label: 'Salary advance',
                  amount: Number(advanceAmount),
                  kind: 'deduction' as const,
                },
              ]
            : []),
        ],
        incentiveAmount: incentive,
        grossPay,
        totalDeductions: deductions,
        netPay,
        notes: notes.trim() || undefined,
      })
      onSuccess()
    } catch (err) {
      logger.error(
        'hr-payroll.slip-save-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-base/70 px-4 py-8 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-3xl space-y-4 rounded-2xl border border-border bg-panel p-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {slip ? 'Edit slip' : 'New slip'}
            </h3>
            <p className="text-sm text-muted">
              Run {run.monthIso} · {run.label}
            </p>
          </div>
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
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Employee</span>
          <select
            className="ui-field min-h-10 w-full"
            value={employeeId}
            onChange={(event) => loadProfile(event.target.value)}
            required
            disabled={Boolean(slip)}
          >
            <option value="">Select…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role}
              </option>
            ))}
          </select>
        </label>

        {employee ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-base/30 px-3 py-2 text-xs">
            <button
              type="button"
              onClick={pullLiveData}
              disabled={pulling}
              className="rounded-md border border-accent/60 bg-accent/15 px-3 py-1 font-medium text-accent hover:bg-accent/25 disabled:opacity-60"
            >
              {pulling ? 'Pulling…' : 'Pull incentives + shift attendance'}
            </button>
            <span className="text-muted">
              Reads {employee.role === 'Cashier' ? 'cashierIncentives' : 'shifts only'} for {run.monthIso}
            </span>
            {pullSummary ? (
              <span className="tabular-nums text-foreground">{pullSummary}</span>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <NumberField label="Base salary" value={baseSalary} onChange={setBaseSalary} />
          <NumberField label="Working days" value={workingDays} onChange={setWorkingDays} />
          <NumberField label="Present days" value={presentDays} onChange={setPresentDays} />
          <NumberField label="Overtime hrs" value={overtimeHours} onChange={setOvertimeHours} />
          <NumberField label="Incentive" value={incentiveAmount} onChange={setIncentiveAmount} />
        </div>

        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-xs uppercase tracking-wide text-muted">Deductions</legend>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <NumberField label="TDS" value={tdsAmount} onChange={setTdsAmount} />
            <NumberField label="PF" value={pfAmount} onChange={setPfAmount} />
            <NumberField label="ESI" value={esiAmount} onChange={setEsiAmount} />
            <NumberField label="Advance" value={advanceAmount} onChange={setAdvanceAmount} />
          </div>
        </fieldset>

        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Notes</span>
          <textarea
            className="ui-field min-h-16 w-full"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
          />
        </label>

        <div className="rounded-xl border border-border bg-base/30 p-4">
          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
            <Computed label="LOP days" value={String(lopDays)} />
            <Computed label="LOP deducted" value={formatINR(lopAmount)} tone="warning" />
            <Computed label="Overtime pay" value={formatINR(otPay)} />
            <Computed label="Gross" value={formatINR(grossPay)} />
            <Computed label="Deductions" value={formatINR(deductions)} tone="critical" />
            <Computed label="Net pay" value={formatINR(netPay)} tone="success" />
          </div>
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
            className="rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save slip'}
          </button>
        </div>
      </form>
    </div>
  )
}

const NumberField = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) => (
  <label className="block text-sm">
    <span className="mb-1 block text-xs uppercase tracking-wide text-muted">{label}</span>
    <input
      type="number"
      step="0.01"
      className="ui-field min-h-10 w-full tabular-nums"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
)

const Computed = ({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warning' | 'critical' | 'success'
}) => (
  <div>
    <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    <div
      className={`tabular-nums font-semibold ${
        tone === 'warning'
          ? 'text-warning'
          : tone === 'critical'
            ? 'text-critical'
            : tone === 'success'
              ? 'text-success'
              : 'text-foreground'
      }`}
    >
      {value}
    </div>
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

export default HRPayrollModule
