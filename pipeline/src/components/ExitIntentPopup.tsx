import { useCallback, useEffect, useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { trackLeadGenerated } from '../lib/tracking'
import { useBooking } from '../contexts/BookingContext'
import { getLocationDisplayName } from '../lib/locations'
import { X } from 'lucide-react'

const SESSION_KEY = 'asquare_exit_popup_shown'

import { normalizePhone } from '../services/userMerge'

const ExitIntentPopup = () => {
  const { selectedLocation } = useBooking()
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const triggerPopup = useCallback(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return
    setShow(true)
    sessionStorage.setItem(SESSION_KEY, '1')
  }, [])

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return

    // Desktop: mouse leaves viewport from top
    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) triggerPopup()
    }

    // Mobile: after 30s idle
    const timer = setTimeout(triggerPopup, 30000)

    document.addEventListener('mouseout', handleMouseLeave)
    return () => {
      document.removeEventListener('mouseout', handleMouseLeave)
      clearTimeout(timer)
    }
  }, [triggerPopup])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizePhone(phone)
    if (normalized.length !== 10) return

    setSubmitting(true)
    try {
      await addDoc(collection(db, 'leads'), {
        customerName: name.trim(),
        customerPhone: normalized,
        customerEmail: null,
        source: 'exit_intent',
        sourceRef: 'exit_popup_100off',
        branchId: selectedLocation ?? '',
        branchName: selectedLocation ? getLocationDisplayName(selectedLocation) : '',
        status: 'new',
        score: 50,
        scoreLabel: 'warm',
        scoreFactors: { recencyDays: 0, visitCount: 0, totalSpend: 0 },
        consecutiveNoAnswer: 0,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'website',
      })
      trackLeadGenerated('exit_intent', { offer: '100_off' })
      setSubmitted(true)
    } catch {
      // silent
    } finally {
      setSubmitting(false)
    }
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => setShow(false)}
          className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
        >
          <X size={20} />
        </button>

        {submitted ? (
          <div className="text-center py-4">
            <p className="text-2xl font-bold text-green-600 mb-2">You're in!</p>
            <p className="text-gray-600">We'll call you with your exclusive offer.</p>
          </div>
        ) : (
          <>
            <div className="text-center mb-4">
              <p className="text-3xl font-black text-secondary-500">Wait!</p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                Grab &#8377;100 off your first race!
              </p>
              <p className="text-sm text-gray-500">
                Enter your details and we'll send you the offer.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-secondary-500 py-3 text-sm font-bold text-white transition hover:bg-secondary-600 disabled:opacity-50"
              >
                {submitting ? '...' : 'Claim My ₹100 Off'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default ExitIntentPopup
