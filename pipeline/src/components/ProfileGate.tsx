import { useState } from 'react'
import { motion } from 'framer-motion'
import { User, Phone, Mail, X, AlertCircle, CheckCircle } from 'lucide-react'

interface ProfileGateProps {
  user: {
    displayName?: string | null
    phone?: string | null
    email?: string | null
  }
  onComplete: (data: { phone: string; email: string }) => void
  onClose: () => void
}

export default function ProfileGate({ user, onComplete, onClose }: ProfileGateProps) {
  const [phone, setPhone] = useState(user.phone || '')
  const [email, setEmail] = useState(user.email || '')
  const [errors, setErrors] = useState<{ phone?: string; email?: string }>({})

  const validatePhone = (value: string) => {
    const digits = value.trim().replace(/\D/g, '').slice(-10)
    return digits.length === 10
  }

  const validateEmail = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return false
    return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(trimmed)
  }

  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = () => {
    if (submitting) return
    const newErrors: { phone?: string; email?: string } = {}

    const trimmedPhone = phone.trim()
    const trimmedEmail = email.trim()

    if (!validatePhone(trimmedPhone)) {
      newErrors.phone = 'Please enter a valid 10-digit phone number'
    }
    if (!validateEmail(trimmedEmail)) {
      newErrors.email = 'Please enter a valid email address'
    }

    setErrors(newErrors)

    if (Object.keys(newErrors).length === 0) {
      setSubmitting(true)
      onComplete({ phone: trimmedPhone.replace(/\D/g, '').slice(-10), email: trimmedEmail })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-dark-950/90 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="relative bg-dark-900 border border-white/10 rounded-3xl p-6 w-full max-w-md lg:max-w-lg shadow-2xl"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-dark-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-primary-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-primary-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">Complete Your Profile</h2>
          <p className="text-dark-400 text-sm">
            We need your contact details for booking confirmation
          </p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Phone Input */}
          <div>
            <label className="text-dark-300 text-sm mb-1.5 block">Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter 10-digit phone"
                className={`w-full bg-dark-800 border ${errors.phone ? 'border-red-500' : 'border-white/10'} rounded-xl pl-12 pr-4 py-3 text-white placeholder-dark-500 focus:outline-none focus:border-primary-500 transition-colors`}
              />
              {phone && validatePhone(phone) && (
                <CheckCircle className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-green-400" />
              )}
            </div>
            {errors.phone && (
              <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.phone}
              </p>
            )}
          </div>

          {/* Email Input */}
          <div>
            <label className="text-dark-300 text-sm mb-1.5 block">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={`w-full bg-dark-800 border ${errors.email ? 'border-red-500' : 'border-white/10'} rounded-xl pl-12 pr-4 py-3 text-white placeholder-dark-500 focus:outline-none focus:border-primary-500 transition-colors`}
              />
              {email && validateEmail(email) && (
                <CheckCircle className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-green-400" />
              )}
            </div>
            {errors.email && (
              <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors.email}
              </p>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`w-full mt-6 py-4 rounded-xl font-bold shadow-lg transition-all ${
            submitting
              ? 'bg-dark-700 text-dark-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-primary-500/30 hover:shadow-primary-500/50'
          }`}
        >
          {submitting ? 'Processing...' : 'Continue to Payment'}
        </button>
      </motion.div>
    </div>
  )
}
