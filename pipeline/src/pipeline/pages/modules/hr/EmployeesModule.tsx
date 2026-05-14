import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { FileText, Save, User as UserIcon } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import EmptyState from '../../../../components/ui/EmptyState'
import Skeleton from '../../../../components/ui/Skeleton'
import { listFirestoreUsers } from '../../../api/users-firestore'
import {
  getHREmployeeProfile,
  upsertHREmployeeProfile,
} from '../../../api/hr-employee-firestore'
import { listFirestoreHRDocuments } from '../../../api/hr-documents-firestore'
import { HREmployeeProfileExt } from '../../../api/types'
import { logger } from '../../../../lib/logger'

export type EmployeesView = 'list' | 'detail'

const EmployeesModule = ({ view }: { view: EmployeesView }) => {
  const { employeeId } = useParams<{ employeeId?: string }>()
  if (view === 'detail') {
    if (!employeeId) return <Navigate replace to="/admin/users" />
    return <EmployeesDetail employeeId={employeeId} />
  }
  // The canonical employee directory is /admin/users (AdminModule view="users").
  // Redirect rather than maintain a duplicate list. Per-employee HR profile
  // overlay lives at /hr/employees/:employeeId.
  return <Navigate replace to="/admin/users" />
}


const EmployeesDetail = ({ employeeId }: { employeeId: string }) => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<HREmployeeProfileExt>({})
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const results = useQueries({
    queries: [
      {
        queryKey: ['hr-employee-user', employeeId],
        queryFn: async () => {
          const list = await listFirestoreUsers({})
          return list.find((user) => user.id === employeeId) ?? null
        },
        enabled: Boolean(token),
      },
      {
        queryKey: ['hr-employee-profile', employeeId],
        queryFn: () => getHREmployeeProfile(employeeId),
        enabled: Boolean(token),
      },
      {
        queryKey: ['hr-employee-documents', employeeId],
        queryFn: () => listFirestoreHRDocuments({ employeeId }),
        enabled: Boolean(token),
      },
    ],
  })
  const userQuery = results[0]
  const profileQuery = results[1]
  const documentsQuery = results[2]

  const user = userQuery.data ?? null
  const profile = profileQuery.data ?? {}
  const documents = documentsQuery.data ?? []

  const saveMutation = useMutation({
    mutationFn: () => upsertHREmployeeProfile(token, employeeId, draft),
    onSuccess: () => {
      setEditing(false)
      setFeedback('Profile saved.')
      void queryClient.invalidateQueries({ queryKey: ['hr-employee-profile', employeeId] })
    },
    onError: (err: unknown) => {
      logger.error(
        'hr-employee.save-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      setError('Failed to save profile.')
    },
  })

  if (userQuery.isLoading || profileQuery.isLoading) {
    return (
      <ModulePageLayout
        moduleTab="Employees"
        title="Employee"
        subtitle="Loading…"
        breadcrumbs={['Pipeline', 'HR', 'Employees', '…']}
      >
        <Skeleton className="h-40 w-full" />
      </ModulePageLayout>
    )
  }

  if (!user) {
    return (
      <ModulePageLayout
        moduleTab="Employees"
        title="Employee not found"
        subtitle="The user record could not be located."
        breadcrumbs={['Pipeline', 'HR', 'Employees', 'Not found']}
      >
        <EmptyState
          title="Employee not found"
          description="The user may have been removed."
          icon={<UserIcon className="h-8 w-8" />}
        />
      </ModulePageLayout>
    )
  }

  const startEdit = () => {
    setDraft({ ...profile })
    setEditing(true)
  }

  return (
    <ModulePageLayout
      moduleTab="Employees"
      title={user.name}
      subtitle={`${user.role} · ${user.isActive ? 'Active' : 'Inactive'}`}
      breadcrumbs={['Pipeline', 'HR', 'Employees', user.name]}
      subnavActions={
        !editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
          >
            Edit profile
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Personal details">
          <ReadField label="Full name" value={user.name} />
          <ReadField label="Email" value={user.email} />
          <ReadField label="Phone" value={user.phone || '—'} />
          <EditableField
            label="Address"
            value={profile.address}
            draft={editing ? draft.address : undefined}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, address: value }))}
          />
          <EditableField
            label="Blood group"
            value={profile.bloodGroup}
            draft={editing ? draft.bloodGroup : undefined}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, bloodGroup: value }))}
          />
        </Section>

        <Section title="Employment">
          <ReadField label="Role" value={user.role} />
          <EditableField
            label="Designation"
            value={profile.designation}
            draft={editing ? draft.designation : undefined}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, designation: value }))}
          />
          <EditableField
            label="Date of joining"
            value={profile.dateOfJoining}
            draft={editing ? draft.dateOfJoining : undefined}
            editing={editing}
            type="date"
            onChange={(value) => setDraft((prev) => ({ ...prev, dateOfJoining: value }))}
          />
          <EditableField
            label="Reporting manager"
            value={profile.reportingManagerName}
            draft={editing ? draft.reportingManagerName : undefined}
            editing={editing}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, reportingManagerName: value }))
            }
          />
          <EditableField
            label="Base salary (₹/month)"
            value={profile.baseSalary ? `₹${profile.baseSalary.toLocaleString('en-IN')}` : '—'}
            draft={editing ? (draft.baseSalary?.toString() ?? '') : undefined}
            editing={editing}
            type="number"
            onChange={(value) =>
              setDraft((prev) => ({
                ...prev,
                baseSalary: value ? Number(value) : undefined,
              }))
            }
          />
        </Section>

        <Section title="Emergency contact">
          <EditableField
            label="Contact name"
            value={profile.emergencyContactName}
            draft={editing ? draft.emergencyContactName : undefined}
            editing={editing}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, emergencyContactName: value }))
            }
          />
          <EditableField
            label="Contact phone"
            value={profile.emergencyContactPhone}
            draft={editing ? draft.emergencyContactPhone : undefined}
            editing={editing}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, emergencyContactPhone: value }))
            }
          />
          <EditableField
            label="Relation"
            value={profile.emergencyContactRelation}
            draft={editing ? draft.emergencyContactRelation : undefined}
            editing={editing}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, emergencyContactRelation: value }))
            }
          />
        </Section>

        <Section title="Bank & KYC">
          <EditableField
            label="Bank name"
            value={profile.bankName}
            draft={editing ? draft.bankName : undefined}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, bankName: value }))}
          />
          <EditableField
            label="Account number"
            value={profile.bankAccountNumber}
            draft={editing ? draft.bankAccountNumber : undefined}
            editing={editing}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, bankAccountNumber: value }))
            }
          />
          <EditableField
            label="IFSC"
            value={profile.bankIfsc}
            draft={editing ? draft.bankIfsc : undefined}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, bankIfsc: value }))}
          />
          <EditableField
            label="PAN"
            value={profile.panNumber}
            draft={editing ? draft.panNumber : undefined}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, panNumber: value }))}
          />
          <EditableField
            label="Aadhaar (last 4)"
            value={profile.aadhaarLast4}
            draft={editing ? draft.aadhaarLast4 : undefined}
            editing={editing}
            onChange={(value) => setDraft((prev) => ({ ...prev, aadhaarLast4: value }))}
          />
        </Section>
      </div>

      <Section title="Documents" className="mt-4">
        {documentsQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted">
            No documents uploaded yet.{' '}
            <a href="/hr/documents" className="text-accent hover:underline">
              Upload one →
            </a>
          </p>
        ) : (
          <div className="divide-y divide-border">
            {documents.map((document) => (
              <a
                key={document.id}
                href={document.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between py-2.5 text-sm hover:bg-base/40"
              >
                <div className="flex items-center gap-2 text-foreground">
                  <FileText className="h-4 w-4 text-muted" />
                  <span>{document.title}</span>
                </div>
                <span className="text-xs text-muted">{document.documentType}</span>
              </a>
            ))}
          </div>
        )}
      </Section>
    </ModulePageLayout>
  )
}

const Section = ({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) => (
  <div className={`rounded-xl border border-border bg-panel p-4 ${className}`}>
    <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
    <div className="space-y-2">{children}</div>
  </div>
)

const ReadField = ({ label, value }: { label: string; value: string | undefined }) => (
  <div className="grid grid-cols-3 gap-3 text-sm">
    <span className="text-muted">{label}</span>
    <span className="col-span-2 text-foreground">{value || '—'}</span>
  </div>
)

const EditableField = ({
  label,
  value,
  draft,
  editing,
  type = 'text',
  onChange,
}: {
  label: string
  value: string | undefined
  draft: string | undefined
  editing: boolean
  type?: 'text' | 'date' | 'number'
  onChange: (value: string) => void
}) => (
  <div className="grid grid-cols-3 gap-3 text-sm">
    <span className="text-muted">{label}</span>
    {editing ? (
      <input
        className="ui-field col-span-2 min-h-9"
        type={type}
        value={draft ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    ) : (
      <span className="col-span-2 text-foreground">{value || '—'}</span>
    )}
  </div>
)

export default EmployeesModule
