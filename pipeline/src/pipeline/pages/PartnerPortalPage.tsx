import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { INVESTMENT_RANGES, submitPartnerInquiry } from '../api/partner-inquiries-firestore'
import type { InvestmentRange } from '../api/partner-inquiries-firestore'
import { getEnabledLocations } from '../../lib/locations'

const branchOptions = getEnabledLocations().map((l) => ({ value: l.branchId, label: l.shortName }))

const PartnerPortalPage = () => {
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const isLight = mode === 'light'

  const [name, setName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [location, setLocation] = useState('')
  const [investmentRange, setInvestmentRange] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const toggleTheme = () => setMode(isLight ? 'dark' : 'light')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await submitPartnerInquiry({
        name,
        phoneNumber,
        location,
        investmentRange: investmentRange as InvestmentRange,
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = isLight
    ? 'w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-500/10'
    : 'w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3.5 text-sm text-gray-100 transition-all placeholder:text-gray-500 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/10'

  const selectClass = isLight
    ? 'w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-sm text-gray-900 transition-all focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-500/10'
    : 'w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3.5 text-sm text-gray-100 transition-all focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/10'

  const labelClass = isLight
    ? 'text-xs font-semibold uppercase tracking-wider text-gray-500'
    : 'text-xs font-semibold uppercase tracking-wider text-gray-400'

  const cardClass = `w-full max-w-lg rounded-3xl border p-8 sm:p-10 backdrop-blur-xl transition-all duration-500 ${
    isLight
      ? 'bg-white/90 border-gray-200 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_0_15px_rgba(20,184,166,0.05)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08),0_0_25px_rgba(20,184,166,0.1)]'
      : 'bg-gray-900/60 border-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.1),0_0_40px_rgba(34,211,238,0.05)] hover:shadow-[0_0_35px_rgba(34,211,238,0.2),0_0_65px_rgba(34,211,238,0.1)] hover:border-cyan-500/40'
  }`

  return (
    <main
      className={`relative min-h-screen w-full overflow-hidden font-sans transition-colors duration-400 ${isLight ? 'bg-gray-50 text-gray-900' : 'bg-signal-navy-deep text-gray-100'}`}
    >
      {/* Light Mode Visual Sources */}
      <AnimatePresence>
        {isLight && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          >
            <div
              className="absolute left-[20%] -top-[10%] h-[500px] w-[800px] rounded-full blur-[120px] opacity-40"
              style={{ background: 'radial-gradient(circle, #facc15 0%, transparent 70%)' }}
            />
            <div
              className="absolute right-[10%] -top-[5%] h-[400px] w-[600px] rounded-full blur-[100px] opacity-30"
              style={{ background: 'radial-gradient(circle, #fde68a 0%, transparent 70%)' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Gradients */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className={`absolute -left-[10%] -top-[10%] h-[50%] w-[50%] rounded-full transition-opacity duration-700 ${isLight ? 'bg-blue-500/5 opacity-50' : 'bg-blue-500/10 opacity-100'} blur-[120px]`}
        />
        <div
          className={`absolute -right-[10%] bottom-[10%] h-[45%] w-[45%] rounded-full transition-opacity duration-700 ${isLight ? 'bg-cyan-500/5 opacity-40' : 'bg-cyan-500/10 opacity-100'} blur-[120px]`}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col-reverse lg:flex-row">
        {/* Left Branding Panel */}
        <section className="flex flex-1 flex-col justify-center p-8 lg:p-16 xl:p-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Logo + badge visible only on desktop */}
            <div className="hidden lg:block">
              <div className="mb-6 flex items-center gap-2">
                <div className="h-2 w-10 rounded-full bg-accent" />
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                  Partner Portal
                </span>
              </div>
              <img
                src={`${import.meta.env.BASE_URL}${isLight ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
                alt="A Square GoKarting"
                className="h-20 w-auto object-contain sm:h-24 lg:h-28 drop-shadow-lg"
                draggable={false}
              />
            </div>
            <p
              className={`mt-6 max-w-xl text-lg leading-relaxed ${isLight ? 'text-gray-500' : 'text-gray-400'}`}
            >
              Interested in partnering with A Square GoKarting? Share your details and our team will
              get in touch with you.
            </p>

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {[
                {
                  label: 'Franchise Opportunities',
                  desc: 'Explore franchise options across multiple locations',
                },
                {
                  label: 'Investment Plans',
                  desc: 'Flexible investment ranges to match your budget',
                },
                { label: 'Full Support', desc: 'End-to-end operational and marketing support' },
                {
                  label: 'Growing Network',
                  desc: 'Join our expanding network across Andhra Pradesh',
                },
              ].map((item, idx) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.2 + idx * 0.1 }}
                  className={`group rounded-2xl border p-4 transition-all hover:border-primary-500/40 ${isLight ? 'border-gray-200 bg-white/80 shadow-sm' : 'border-gray-700/40 bg-gray-800/40 hover:bg-gray-800/60'}`}
                >
                  <p
                    className={`text-sm font-semibold group-hover:text-primary-500 transition-colors ${isLight ? 'text-gray-900' : 'text-gray-100'}`}
                  >
                    {item.label}
                  </p>
                  <p className={`mt-1 text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    {item.desc}
                  </p>
                </motion.div>
              ))}
            </div>

            <div className="mt-10">
              <Link
                to="/activities"
                className={`inline-flex items-center gap-2 text-xs font-semibold transition-colors hover:text-primary-500 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back to Activities
              </Link>
            </div>
          </motion.div>
        </section>

        {/* Right Form Panel */}
        <section className="flex flex-1 flex-col items-center justify-center p-6 lg:p-12">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 flex flex-col items-center gap-4 lg:hidden"
          >
            <img
              src={`${import.meta.env.BASE_URL}${isLight ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
              alt="A Square GoKarting"
              className="h-16 w-auto object-contain sm:h-20 drop-shadow-lg"
              draggable={false}
            />
            <div className="flex items-center gap-2">
              <div className="h-2 w-10 rounded-full bg-accent" />
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                Partner Portal
              </span>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={cardClass}
          >
            {/* Card Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2
                  className={`font-display text-3xl font-bold ${isLight ? 'text-gray-900' : 'text-gray-100'}`}
                >
                  Partner Inquiry
                </h2>
                <p className={`mt-2 text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  Fill in your details and we'll reach out to you
                </p>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                title={isLight ? 'Turn off lights' : 'Turn on lights'}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300 ${isLight ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border bg-surface text-muted hover:text-text'}`}
              >
                <AnimatePresence mode="wait">
                  {isLight ? (
                    <motion.div
                      key="sun"
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: 90 }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5 fill-amber-500"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm0-9V3a1 1 0 0 0-2 0v3a1 1 0 0 0 2 0zm0 15v3a1 1 0 0 0 2 0v-3a1 1 0 0 0-2 0zM5.64 6.64a1 1 0 0 0 0-1.41L3.52 3.11a1 1 0 0 0-1.41 1.41l2.12 2.12a1 1 0 0 0 1.41 0zm14.85 14.85a1 1 0 0 0 0-1.41l-2.12-2.12a1 1 0 0 0-1.41 1.41l2.12 2.12a1 1 0 0 0 1.41 0zM3 12a1 1 0 0 0 0-2H1a1 1 0 0 0 0 2zm20-2h-2a1 1 0 0 0 0 2h2a1 1 0 0 0 0-2zm-2.51-4.73-2.12 2.12a1 1 0 0 0 1.41 1.41l2.12-2.12a1 1 0 0 0-1.41-1.41zM6.64 18.36a1 1 0 0 0-1.41 0l-2.12 2.12a1 1 0 0 0 1.41 1.41l2.12-2.12a1 1 0 0 0 0-1.41z" />
                      </svg>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="moon"
                      initial={{ scale: 0, rotate: 90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: -90 }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5 opacity-60 group-hover:opacity-100 transition-opacity"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12 3a9 9 0 1 0 9 9 9.75 9.75 0 0 0-.46-2.82 1 1 0 0 0-1.86.7 7.75 7.75 0 1 1-6.13-6.13 1 1 0 0 0 .7-1.86A9.75 9.75 0 0 0 12 3z" />
                      </svg>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </div>

            <AnimatePresence mode="wait">
              {success ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col items-center gap-4 py-8 text-center"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                    <svg
                      className="h-8 w-8 text-emerald-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h3
                    className={`text-xl font-bold ${isLight ? 'text-gray-900' : 'text-gray-100'}`}
                  >
                    Thank You!
                  </h3>
                  <p className={`text-sm max-w-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    Your inquiry has been submitted successfully. Our team will contact you shortly.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSuccess(false)
                      setName('')
                      setPhoneNumber('')
                      setLocation('')
                      setInvestmentRange('')
                    }}
                    className="mt-4 rounded-2xl border border-primary-500/30 px-6 py-2.5 text-sm font-semibold text-primary-500 transition-all hover:bg-primary-500/10"
                  >
                    Submit Another Inquiry
                  </button>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onSubmit={handleSubmit}
                  className="space-y-5"
                >
                  {/* Name */}
                  <div className="space-y-1.5">
                    <label className={labelClass}>Full Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your full name"
                      className={inputClass}
                      required
                    />
                  </div>

                  {/* Phone Number */}
                  <div className="space-y-1.5">
                    <label className={labelClass}>Phone Number</label>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) =>
                        setPhoneNumber(e.target.value.replace(/[^\d]/g, '').slice(0, 10))
                      }
                      placeholder="10-digit mobile number"
                      className={inputClass}
                      maxLength={10}
                      required
                    />
                  </div>

                  {/* Location */}
                  <div className="space-y-1.5">
                    <label className={labelClass}>Preferred Location</label>
                    <select
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className={selectClass}
                      required
                      title="Preferred Location"
                    >
                      <option value="">Select a location</option>
                      {branchOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Investment Range */}
                  <div className="space-y-1.5">
                    <label className={labelClass}>Investment Range</label>
                    <select
                      value={investmentRange}
                      onChange={(e) => setInvestmentRange(e.target.value)}
                      className={selectClass}
                      required
                      title="Investment Range"
                    >
                      <option value="">Select investment range</option>
                      {INVESTMENT_RANGES.map((range) => (
                        <option key={range} value={range}>
                          {range}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Error */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500"
                    >
                      {error}
                    </motion.div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="group relative w-full overflow-hidden rounded-2xl bg-accent py-4 text-sm font-bold text-panel transition-all hover:translate-y-[-2px] hover:shadow-[0_8px_30px_rgb(var(--color-accent)/0.3)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {loading ? 'Submitting...' : 'Submit Inquiry'}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        </section>
      </div>
    </main>
  )
}

export default PartnerPortalPage
