import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MessageSquarePlus, Loader2, CheckCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { ticketCustomerService } from '../../services/ticketCustomerService'
import { getAllLocations } from '../../lib/locations'
import { logger } from '../../lib/logger'
import type { TicketCategory } from '../../types'

interface CustomerRaiseTicketModalProps {
  open: boolean
  onClose: () => void
  /** Pre-link the ticket to a booking (used from BookingDetails). */
  bookingId?: string
  /** Pre-select a branch (used when context already knows it). */
  defaultBranchId?: string
}

const TITLE_MAX = 120
const DESC_MIN = 10

export default function CustomerRaiseTicketModal({
  open,
  onClose,
  bookingId,
  defaultBranchId,
}: CustomerRaiseTicketModalProps) {
  const { user } = useAuth()

  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoryId, setCategoryId] = useState<string>('')
  const [branchId, setBranchId] = useState<string>(defaultBranchId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const locations = useMemo(() => getAllLocations(), [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCategoriesLoading(true)
    ticketCustomerService
      .listActiveCategories()
      .then((rows) => {
        if (cancelled) return
        const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
        setCategories(sorted)
        setCategoryId((current) => {
          if (current && sorted.some((c) => c.id === current)) return current
          return sorted[0]?.id ?? 'other'
        })
      })
      .catch((err) => {
        logger.warn('customer.ticket_modal.categories_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        if (!cancelled) setCategoryId('other')
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset state when modal closes.
  useEffect(() => {
    if (open) return
    setTitle('')
    setDescription('')
    setErrors({})
    setErrorMsg(null)
    setSuccess(null)
    setBranchId(defaultBranchId ?? '')
  }, [open, defaultBranchId])

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!title.trim()) next.title = 'Title is required'
    else if (title.trim().length > TITLE_MAX) next.title = `Max ${TITLE_MAX} characters`
    if (description.trim().length < DESC_MIN)
      next.description = `Minimum ${DESC_MIN} characters required`
    if (!branchId) next.branch = 'Please select a branch'
    if (!categoryId) next.category = 'Please choose a category'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) {
      setErrorMsg('Please sign in to raise a ticket.')
      return
    }
    if (!validate()) return

    setSubmitting(true)
    setErrorMsg(null)
    try {
      const branch = locations.find((l) => l.slug === branchId || l.branchId === branchId)
      const ticketId = await ticketCustomerService.createTicket({
        userId: user.id,
        userName: user.displayName || 'Customer',
        branchId,
        branchDisplayName: branch?.displayName ?? branchId,
        categoryId: categoryId || 'other',
        title: title.trim(),
        description: description.trim(),
        bookingId,
      })
      setSuccess(ticketId)
      setTimeout(() => {
        onClose()
        setSuccess(null)
      }, 2500)
    } catch (err) {
      logger.error('customer.ticket_modal.submit_failed', err)
      const message =
        err instanceof Error ? err.message : 'Failed to raise ticket. Please try again.'
      setErrorMsg(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md lg:max-w-lg bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            {/* Background Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-primary-500/20 blur-3xl rounded-full pointer-events-none" />

            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 z-20 p-2 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white"
              aria-label="Close"
            >
              <X size={20} />
            </button>

            <div className="relative z-10">
              {success ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Ticket raised!</h3>
                  <p className="text-white/60 text-sm">
                    Reference&nbsp;
                    <span className="font-mono text-white">{success}</span>
                    <br />
                    Our team will get back to you shortly.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <div className="w-12 h-12 bg-primary-500/20 rounded-xl flex items-center justify-center mb-4">
                      <MessageSquarePlus className="w-6 h-6 text-primary-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Raise a ticket</h2>
                    <p className="text-white/60 text-sm">
                      Tell us what went wrong — we&rsquo;ll route this to the right team.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {errorMsg && (
                      <div
                        role="alert"
                        className="p-2.5 rounded-lg text-sm text-red-400 bg-red-500/10 border border-red-500/20"
                      >
                        {errorMsg}
                      </div>
                    )}

                    {bookingId && (
                      <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/20 text-sm text-white/80">
                        Linked booking:&nbsp;
                        <span className="font-mono text-primary-300">{bookingId}</span>
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor="cust-ticket-category"
                        className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider"
                      >
                        Category
                      </label>
                      <select
                        id="cust-ticket-category"
                        value={categoryId}
                        disabled={categoriesLoading}
                        onChange={(e) => setCategoryId(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500/50 transition-colors disabled:opacity-60"
                      >
                        {categoriesLoading ? (
                          <option value="">Loading…</option>
                        ) : categories.length === 0 ? (
                          <option value="other">Other</option>
                        ) : (
                          categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))
                        )}
                      </select>
                      {errors.category && (
                        <p className="mt-1 text-xs text-red-400">{errors.category}</p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="cust-ticket-branch"
                        className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider"
                      >
                        Branch
                      </label>
                      <select
                        id="cust-ticket-branch"
                        value={branchId}
                        onChange={(e) => setBranchId(e.target.value)}
                        disabled={Boolean(defaultBranchId)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500/50 transition-colors disabled:opacity-60"
                      >
                        <option value="">Select a branch</option>
                        {locations.map((l) => (
                          <option key={l.slug} value={l.slug}>
                            {l.displayName}
                          </option>
                        ))}
                      </select>
                      {errors.branch && (
                        <p className="mt-1 text-xs text-red-400">{errors.branch}</p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="cust-ticket-title"
                        className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider"
                      >
                        Title
                      </label>
                      <input
                        id="cust-ticket-title"
                        type="text"
                        maxLength={TITLE_MAX}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary-500/50 transition-colors"
                        placeholder="Short summary of the issue"
                      />
                      <p className="mt-1 text-xs text-white/30">
                        {title.length}/{TITLE_MAX}
                      </p>
                      {errors.title && (
                        <p className="mt-0.5 text-xs text-red-400">{errors.title}</p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="cust-ticket-desc"
                        className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider"
                      >
                        Description
                      </label>
                      <textarea
                        id="cust-ticket-desc"
                        rows={4}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary-500/50 transition-colors resize-y"
                        placeholder="What happened? Include any details that might help us fix it."
                      />
                      <p className="mt-1 text-xs text-white/30">
                        {description.trim().length}/{DESC_MIN} min characters
                      </p>
                      {errors.description && (
                        <p className="mt-0.5 text-xs text-red-400">{errors.description}</p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-primary-600 hover:bg-primary-500 text-white font-bold py-4 rounded-xl mt-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Submitting…
                        </>
                      ) : (
                        'Raise ticket'
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
