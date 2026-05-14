import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { trackLeadGenerated } from '../lib/tracking'
import { getAllLocations } from '../lib/locations'

const BRANCHES = getAllLocations().map((l) => ({ id: l.branchId, name: l.displayName }))

interface Props {
  sourceRef: string // "birthday" | "corporate" | "school"
  extraFields?: React.ReactNode
}

import { normalizePhone } from '../services/userMerge'

const LeadCaptureForm = ({ sourceRef, extraFields }: Props) => {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [branch, setBranch] = useState('0')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Please enter your name.')
      return
    }
    const normalized = normalizePhone(phone)
    if (normalized.length !== 10) {
      setError('Please enter a valid 10-digit phone number.')
      return
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const branchName = BRANCHES.find((b) => b.id === branch)?.name ?? branch
      await addDoc(collection(db, 'leads'), {
        customerName: name.trim(),
        customerPhone: normalized,
        customerEmail: email.trim() || null,
        source: 'landing_page',
        sourceRef,
        branchId: branch,
        branchName,
        status: 'new',
        score: 60,
        scoreLabel: 'warm',
        scoreFactors: { recencyDays: 0, visitCount: 0, totalSpend: 0 },
        consecutiveNoAnswer: 0,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'website',
        notes: message.trim() || null,
      })
      trackLeadGenerated('landing_page', { source_ref: sourceRef, branch: branchName })
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg bg-green-50 p-8 text-center">
        <h3 className="text-xl font-bold text-green-700 mb-2">Thank You!</h3>
        <p className="text-green-600">
          We'll call you within 24 hours to discuss your requirements.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Your Name *</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="Full name"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Phone Number *</label>
        <input
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="10-digit mobile"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="your@email.com"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Preferred Branch</label>
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          {BRANCHES.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      {extraFields}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Message / Requirements
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="Tell us about your requirements..."
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-primary-500 py-3 text-sm font-bold text-white transition hover:bg-primary-600 disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Get in Touch'}
      </button>
    </form>
  )
}

export default LeadCaptureForm
