import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { FilterBar, FilterField } from '../../../components/ui/FilterBar'
import EmptyState from '../../../../components/ui/EmptyState'
import ErrorState from '../../../../components/ui/ErrorState'
import Skeleton from '../../../../components/ui/Skeleton'
import {
  createFirestoreHRDocument,
  listFirestoreHRDocuments,
  restoreFirestoreHRDocument,
  softDeleteFirestoreHRDocument,
} from '../../../api/hr-documents-firestore'
import { listFirestoreUsers } from '../../../api/users-firestore'
import { HRDocument, HRDocumentType } from '../../../api/types'
import { logger } from '../../../../lib/logger'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'

const DOCUMENT_TYPE_LABELS: Record<HRDocumentType, string> = {
  identity: 'Identity (Aadhaar/Voter)',
  address: 'Address Proof',
  education: 'Education',
  experience: 'Experience Letter',
  offer: 'Offer Letter',
  contract: 'Contract / NDA',
  payslip: 'Payslip',
  medical: 'Medical',
  other: 'Other',
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

const HRDocumentsModule = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const queryClient = useQueryClient()
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<HRDocumentType | ''>('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [search, setSearch] = useState('')
  const [showUploader, setShowUploader] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['hr-documents-users'],
    queryFn: () => listFirestoreUsers({ status: 'Active' }),
    enabled: Boolean(token),
    staleTime: 60_000,
  })

  const documentsQuery = useQuery({
    queryKey: ['hr-documents', employeeFilter, typeFilter, includeDeleted],
    queryFn: () =>
      listFirestoreHRDocuments({
        employeeId: employeeFilter || undefined,
        documentType: typeFilter || undefined,
        includeDeleted,
      }),
    enabled: Boolean(token),
    refetchOnWindowFocus: false,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => softDeleteFirestoreHRDocument(id),
    onSuccess: () => {
      setFeedback('Document removed.')
      void queryClient.invalidateQueries({ queryKey: ['hr-documents'] })
    },
    onError: (err: unknown) => {
      logger.error('hr-documents.delete-failed', err instanceof Error ? err : new Error(String(err)))
      setError('Failed to delete document.')
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreFirestoreHRDocument(id),
    onSuccess: () => {
      setFeedback('Document restored.')
      void queryClient.invalidateQueries({ queryKey: ['hr-documents'] })
    },
  })

  const documents = documentsQuery.data ?? []
  const filteredDocuments = useMemo(() => {
    const text = search.trim().toLowerCase()
    if (!text) return documents
    return documents.filter(
      (document) =>
        document.title.toLowerCase().includes(text) ||
        document.employeeName.toLowerCase().includes(text) ||
        document.fileName.toLowerCase().includes(text),
    )
  }, [documents, search])

  const summary = useMemo(() => {
    const expiringSoon = documents.filter(
      (document) =>
        document.expiresAt &&
        new Date(document.expiresAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000,
    ).length
    const totalSize = documents.reduce((sum, document) => sum + document.fileSize, 0)
    return {
      total: documents.length,
      employees: new Set(documents.map((document) => document.employeeId)).size,
      expiringSoon,
      totalSize,
    }
  }, [documents])

  return (
    <ModulePageLayout
      moduleTab="HRDocs"
      title="HR Documents"
      subtitle="Per-employee identity, contracts, payslips and compliance records."
      breadcrumbs={['Pipeline', 'HR', 'Documents']}
      subnavActions={
        <button
          type="button"
          onClick={() => setShowUploader(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          <Upload className="h-4 w-4" /> Upload document
        </button>
      }
    >
      {error ? (
        <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}{' '}
          <button onClick={() => setError(null)} className="underline">
            dismiss
          </button>
        </p>
      ) : null}
      {feedback ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {feedback}{' '}
          <button onClick={() => setFeedback(null)} className="underline">
            dismiss
          </button>
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total documents" value={String(summary.total)} />
        <SummaryCard label="Employees covered" value={String(summary.employees)} />
        <SummaryCard
          label="Expiring < 30 days"
          value={String(summary.expiringSoon)}
          tone={summary.expiringSoon > 0 ? 'warn' : 'neutral'}
        />
        <SummaryCard label="Storage used" value={formatBytes(summary.totalSize)} />
      </div>

      <FilterBar>
        <FilterField label="Search">
          <input
            className="ui-field min-h-10"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="title, employee, file"
          />
        </FilterField>
        <FilterField label="Employee">
          <select
            className="ui-field min-h-10"
            value={employeeFilter}
            onChange={(event) => setEmployeeFilter(event.target.value)}
          >
            <option value="">All employees</option>
            {(usersQuery.data ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.role})
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Document type">
          <select
            className="ui-field min-h-10"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as HRDocumentType | '')}
          >
            <option value="">All types</option>
            {(Object.keys(DOCUMENT_TYPE_LABELS) as HRDocumentType[]).map((value) => (
              <option key={value} value={value}>
                {DOCUMENT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Include deleted">
          <label className="inline-flex h-10 items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(event) => setIncludeDeleted(event.target.checked)}
            />
            <span>Show trashed</span>
          </label>
        </FilterField>
      </FilterBar>

      <div className="mt-4">
        {documentsQuery.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : documentsQuery.isError ? (
          <ErrorState
            title="Failed to load documents"
            description={(documentsQuery.error as Error).message}
            onRetry={() => {
              void documentsQuery.refetch()
            }}
          />
        ) : filteredDocuments.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Click Upload document to add the first identity, offer letter, or contract."
            icon={<FileText className="h-8 w-8" />}
          />
        ) : (
          <DocumentList
            documents={filteredDocuments}
            onDelete={(id) => deleteMutation.mutate(id)}
            onRestore={(id) => restoreMutation.mutate(id)}
            isDeleting={deleteMutation.isPending}
          />
        )}
      </div>

      {showUploader ? (
        <UploadDialog
          users={usersQuery.data ?? []}
          token={token}
          onClose={() => setShowUploader(false)}
          onSuccess={() => {
            setShowUploader(false)
            setFeedback('Document uploaded.')
            void queryClient.invalidateQueries({ queryKey: ['hr-documents'] })
          }}
        />
      ) : null}
    </ModulePageLayout>
  )
}

const SummaryCard = ({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warn'
}) => (
  <div className="rounded-xl border border-border bg-panel p-4">
    <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    <div
      className={`mt-1 font-semibold tabular-nums ${
        tone === 'warn' ? 'text-critical' : 'text-foreground'
      } text-2xl`}
    >
      {value}
    </div>
  </div>
)

const DocumentList = ({
  documents,
  onDelete,
  onRestore,
  isDeleting,
}: {
  documents: HRDocument[]
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  isDeleting: boolean
}) => (
  <div className="overflow-hidden rounded-xl border border-border bg-panel">
    <table className="w-full text-sm">
      <thead className="border-b border-border bg-base/40 text-left text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="px-4 py-2.5">Title</th>
          <th className="px-4 py-2.5">Employee</th>
          <th className="px-4 py-2.5">Type</th>
          <th className="px-4 py-2.5">Size</th>
          <th className="px-4 py-2.5">Uploaded</th>
          <th className="px-4 py-2.5">Expires</th>
          <th className="px-4 py-2.5 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {documents.map((document) => {
          const isExpired =
            document.expiresAt && new Date(document.expiresAt).getTime() < Date.now()
          return (
            <tr key={document.id} className={document.deletedAt ? 'opacity-60' : ''}>
              <td className="px-4 py-3">
                <div className="font-medium text-foreground">{document.title}</div>
                <div className="text-xs text-muted">{document.fileName}</div>
              </td>
              <td className="px-4 py-3 text-foreground">{document.employeeName}</td>
              <td className="px-4 py-3 text-muted">{DOCUMENT_TYPE_LABELS[document.documentType]}</td>
              <td className="px-4 py-3 tabular-nums text-muted">{formatBytes(document.fileSize)}</td>
              <td className="px-4 py-3 tabular-nums text-muted">
                {fmtDateTimeFullIST(document.uploadedAt)}
              </td>
              <td
                className={`px-4 py-3 tabular-nums ${
                  isExpired ? 'text-critical' : 'text-muted'
                }`}
              >
                {document.expiresAt ? document.expiresAt.slice(0, 10) : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex items-center gap-2">
                  <a
                    href={document.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted hover:text-foreground"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  {document.deletedAt ? (
                    <button
                      type="button"
                      onClick={() => onRestore(document.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted hover:text-foreground"
                      title="Restore"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDelete(document.id)}
                      disabled={isDeleting}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-critical hover:bg-critical/10"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)

const UploadDialog = ({
  users,
  token,
  onClose,
  onSuccess,
}: {
  users: { id: string; name: string; role: string }[]
  token: string
  onClose: () => void
  onSuccess: () => void
}) => {
  const [employeeId, setEmployeeId] = useState('')
  const [title, setTitle] = useState('')
  const [documentType, setDocumentType] = useState<HRDocumentType>('identity')
  const [file, setFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const employee = users.find((user) => user.id === employeeId)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) {
      setLocalError('Please choose a file to upload.')
      return
    }
    if (!employee) {
      setLocalError('Please select an employee.')
      return
    }
    setSubmitting(true)
    setLocalError(null)
    try {
      await createFirestoreHRDocument(token, {
        employeeId,
        employeeName: employee.name,
        title: title.trim() || file.name,
        documentType,
        file,
        notes: notes.trim() || undefined,
        expiresAt: expiresAt || undefined,
      })
      onSuccess()
    } catch (err) {
      logger.error(
        'hr-documents.upload-failed',
        err instanceof Error ? err : new Error(String(err)),
      )
      setLocalError(err instanceof Error ? err.message : 'Upload failed.')
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
          <div>
            <h3 className="text-lg font-semibold text-foreground">Upload HR document</h3>
            <p className="text-sm text-muted">Stored in Firebase Storage, indexed per employee.</p>
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

        {localError ? (
          <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {localError}
          </p>
        ) : null}

        <FormRow label="Employee">
          <select
            className="ui-field min-h-10 w-full"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            required
          >
            <option value="">Select employee…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role}
              </option>
            ))}
          </select>
        </FormRow>

        <FormRow label="Document type">
          <select
            className="ui-field min-h-10 w-full"
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value as HRDocumentType)}
          >
            {(Object.keys(DOCUMENT_TYPE_LABELS) as HRDocumentType[]).map((value) => (
              <option key={value} value={value}>
                {DOCUMENT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </FormRow>

        <FormRow label="Title (optional)">
          <input
            className="ui-field min-h-10 w-full"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Aadhaar front + back"
          />
        </FormRow>

        <FormRow label="File">
          <input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-foreground"
            required
          />
          {file ? (
            <p className="mt-1 text-xs text-muted">
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}
        </FormRow>

        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Expires on (optional)">
            <input
              type="date"
              className="ui-field min-h-10 w-full"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </FormRow>
          <FormRow label="Notes (optional)">
            <input
              className="ui-field min-h-10 w-full"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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
            <Upload className="h-4 w-4" /> {submitting ? 'Uploading…' : 'Upload'}
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

export default HRDocumentsModule
