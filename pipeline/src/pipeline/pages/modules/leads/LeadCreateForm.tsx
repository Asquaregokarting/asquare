import { useState } from 'react'
import type { CreateLeadPayload } from '../../../api/leads'
import type { LeadSource } from '../../../api/types'
import { BRANCH_MAP, LEAD_SOURCE_LABELS } from '../../../features/leads/lead-constants'
import { X } from 'lucide-react'

const MANUAL_SOURCES: LeadSource[] = [
  'inquiry_whatsapp',
  'inquiry_call',
  'inquiry_website',
  'manual',
]

interface Props {
  onSubmit: (payload: CreateLeadPayload) => Promise<void>
  onClose: () => void
  busy: boolean
  defaultBranchId?: string
}

const LeadCreateForm = ({ onSubmit, onClose, busy, defaultBranchId }: Props) => {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState<LeadSource>('inquiry_call')
  const [branchId, setBranchId] = useState(defaultBranchId ?? '')
  const [notes, setNotes] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({
      customerName: name,
      customerPhone: phone,
      customerEmail: email || undefined,
      source,
      branchId,
      branchName: BRANCH_MAP[branchId] ?? branchId,
      notes: notes || undefined,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-base/68 p-4">
      <div className="w-full max-w-md rounded-xl border border-border/70 bg-panel p-5 shadow-panel">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text">Create Lead</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text transition">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Name *
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ui-field w-full"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Phone *
            </label>
            <input
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile"
              className="ui-field w-full"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="ui-field w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Source
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as LeadSource)}
                className="ui-field w-full"
              >
                {MANUAL_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Branch
              </label>
              <select
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="ui-field w-full"
              >
                <option value="" disabled>
                  Select Branch
                </option>
                {Object.entries(BRANCH_MAP).map(([id, branchName]) => (
                  <option key={id} value={id}>
                    {branchName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="ui-field w-full"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="ui-btn ui-btn-primary min-h-10 px-4 text-sm"
            >
              {busy ? 'Creating...' : 'Create Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default LeadCreateForm
