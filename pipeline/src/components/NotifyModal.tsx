import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Bell, Loader2 } from 'lucide-react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logger } from '../lib/logger'

interface NotifyModalProps {
  locationId: string
  locationName: string
  isOpen: boolean
  onClose: () => void
}

export default function NotifyModal({
  locationId,
  locationName,
  isOpen,
  onClose,
}: NotifyModalProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await addDoc(collection(db, 'notifications'), {
        type: 'location_interest',
        locationId,
        locationName,
        name,
        phone,
        email,
        status: 'new',
        createdAt: serverTimestamp(),
      })
      setSuccess(true)
      setTimeout(() => {
        onClose()
        setSuccess(false)
        setName('')
        setPhone('')
        setEmail('')
      }, 5000)
    } catch (error) {
      logger.error('notify_modal.submit_failed', error)
      setErrorMsg('Failed to submit. Please try again.')
      setTimeout(() => setErrorMsg(null), 4000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
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
            className="relative w-full max-w-md lg:max-w-lg bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden"
          >
            {/* Background Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-primary-500/20 blur-3xl rounded-full pointer-events-none" />

            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-20 p-2 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            >
              <X size={20} />
            </button>

            <div className="relative z-10">
              {success ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Bell className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Request Received!</h3>
                  <p className="text-white/60">
                    We'll notify you as soon as slots open for {locationName}.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <div className="w-12 h-12 bg-primary-500/20 rounded-xl flex items-center justify-center mb-4">
                      <Bell className="w-6 h-6 text-primary-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Get Notified</h2>
                    <p className="text-white/60 text-sm">
                      Enter your details to receive updates when bookings open for{' '}
                      <span className="text-white font-medium">{locationName}</span>.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {errorMsg && (
                      <div
                        role="alert"
                        className="p-2.5 rounded-lg text-sm text-red-400 bg-red-500/10 border border-red-500/20 text-center"
                      >
                        {errorMsg}
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider">
                        Name
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary-500/50 transition-colors"
                        placeholder="Your full name"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary-500/50 transition-colors"
                        placeholder="Required for updates"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider">
                        Email (Optional)
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-primary-500/50 transition-colors"
                        placeholder="name@example.com"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-primary-600 hover:bg-primary-500 text-white font-bold py-4 rounded-xl mt-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        'Notify Me'
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
