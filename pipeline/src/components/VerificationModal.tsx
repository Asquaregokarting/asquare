import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Phone, X, Mail, User as UserIcon } from 'lucide-react'

const COUNTRY_CODES = [
  { value: '+91', label: 'IN +91' },
  { value: '+1', label: 'US +1' },
  { value: '+44', label: 'UK +44' },
  { value: '+61', label: 'AU +61' },
  { value: '+971', label: 'UAE +971' },
]

interface VerificationModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function VerificationModal({ isOpen, onClose, onSuccess }: VerificationModalProps) {
  const { user, sendOTP, verifyOTP, updateUserProfile } = useAuth()
  const [step, setStep] = useState<'details' | 'otp'>('details')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !user) return

    setName(user.displayName || '')
    setEmail(user.email || '')

    const rawPhone = (user.phone || '').trim()
    const matchedCountry = [...COUNTRY_CODES]
      .sort((a, b) => b.value.length - a.value.length)
      .find((country) => rawPhone.startsWith(country.value))

    if (matchedCountry) {
      setCountryCode(matchedCountry.value)
      setPhone(rawPhone.slice(matchedCountry.value.length).replace(/\D/g, '').slice(0, 10))
      return
    }

    setCountryCode('+91')
    setPhone(rawPhone.replace(/\D/g, '').slice(-10))
  }, [user, isOpen])

  useEffect(() => {
    // Reset on close.
    if (!isOpen) {
      setStep('details')
      setError(null)
      setOtp('')
      return
    }
    // Reset on open too. `confirmationResult` lives in AuthContext's
    // in-memory state — reload the page, switch tabs, or unmount the
    // provider and it's gone. If we kept the modal at step='otp' from
    // a previous session the verify call would throw "Please request
    // an OTP first" with no recovery path. Always start fresh on
    // open so the user always sees the Send-OTP button first.
    setStep('details')
    setError(null)
    setOtp('')
  }, [isOpen])

  const handleSendOtp = async () => {
    if (phone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await sendOTP(`${countryCode}${phone}`, 'verification-recaptcha-container')
      setStep('otp')
    } catch (error: unknown) {
      setError(getErrorMessage(error, 'Failed to send OTP'))
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.length !== 6) return

    setLoading(true)
    setError(null)
    try {
      await verifyOTP(otp)
      const existingPhone = (user?.phone || '').replace(/\D/g, '').slice(-10)

      // Update profile if name/email/phone changed
      if (name !== user?.displayName || email !== user?.email || phone !== existingPhone) {
        await updateUserProfile({ displayName: name, email, phone })
      }

      onSuccess?.()
      onClose()
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Verification failed')
      // Recovery for the lost-confirmation case. AuthContext throws
      // this exact message when `confirmationResult` is null at verify
      // time — typically because the page reloaded between Send and
      // Verify, or the modal carried stale step state from a previous
      // attempt. Bounce back to the details step so the user can
      // resend the OTP rather than getting stuck on the OTP screen.
      if (msg.toLowerCase().includes('request an otp first')) {
        setStep('details')
        setOtp('')
        setError('That OTP session expired. Please tap Send Verification OTP again.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
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
          className="relative w-full max-w-md lg:max-w-lg bg-dark-900 border border-dark-700 rounded-2xl overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="p-6 border-b border-dark-700 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Verify Phone Number</h2>
            <button onClick={onClose} className="text-dark-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            {step === 'details' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1.5">
                    Mobile Number
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="w-28 bg-dark-800 border border-dark-700 rounded-xl px-2 text-dark-200 focus:outline-none focus:border-primary-500"
                    >
                      {COUNTRY_CODES.map((country) => (
                        <option key={country.value} value={country.value}>
                          {country.label}
                        </option>
                      ))}
                    </select>
                    <div className="relative flex-1">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="Enter 10-digit mobile"
                        className="input-field pl-10 w-full"
                        inputMode="numeric"
                        autoComplete="tel-national"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1.5">Name</label>
                  <div className="relative">
                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your Name"
                      className="input-field pl-10 w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="input-field pl-10 w-full"
                    />
                  </div>
                </div>

                <div id="verification-recaptcha-container"></div>

                <button
                  onClick={handleSendOtp}
                  disabled={loading || phone.length !== 10}
                  className="btn-primary w-full mt-4"
                >
                  {loading ? 'Sending OTP...' : 'Send Verification OTP'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerify} className="space-y-6">
                <div className="text-center">
                  <p className="text-dark-300 mb-2">Enter the OTP sent to</p>
                  <p className="text-white font-mono text-lg">
                    {countryCode} {phone}
                  </p>
                </div>

                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="input-field w-full text-center text-3xl tracking-[0.5em] h-16"
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus OTP field on modal open
                  autoFocus
                  maxLength={6}
                />

                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="btn-primary w-full"
                >
                  {loading ? 'Verifying...' : 'Verify & Complete'}
                </button>

                <button
                  type="button"
                  onClick={() => setStep('details')}
                  className="w-full text-center text-sm text-dark-400 hover:text-white"
                >
                  Back to details
                </button>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
