import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ApiError } from '../api/client'
import { vendorRegistrationApi } from '../api/vendor-registration'
import { VendorRegistrationPayload } from '../api/types'
import { useAuth } from '../features/auth/auth-context'
import { rolePathMap } from '../features/dashboard/role-config'
import { useTheme } from '../features/theme/theme-context'
import { isValidMobile, normalizeMobile, resetOtpState, sendOtp, verifyOtp } from '../lib/phone-otp'
import { getEnabledLocations } from '../../lib/locations'

type PortalTab = 'login' | 'register'

const branchOptions = getEnabledLocations().map((l) => ({ value: l.branchId, label: l.shortName }))

const emptyRegisterForm = () => ({
  branchId: '',
  vendorName: '',
  companyName: '',
  mobileNumber: '',
  email: '',
  gstNumber: '',
  address: '',
  bankAccountNumber: '',
  bankName: '',
  ifscCode: '',
  bankBranch: '',
  password: '',
  confirmPassword: '',
})

const inputClass =
  'w-full rounded-2xl border border-border/40 bg-surface px-4 py-3.5 text-sm text-text transition-all placeholder:text-muted/60 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10'
const labelClass = 'text-xs font-semibold uppercase tracking-wider text-muted'
const selectClass =
  'w-full rounded-2xl border border-border/40 bg-surface px-4 py-3.5 text-sm text-text transition-all focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10'

const ThirdPartyPortalPage = () => {
  const { session, login } = useAuth()
  const { mode, setMode } = useTheme()
  const navigate = useNavigate()
  const isLight = mode === 'light'

  const [tab, setTab] = useState<PortalTab>('login')

  // Login state
  const [loginId, setLoginId] = useState('')
  const [loginPwd, setLoginPwd] = useState('')
  const [showLoginPwd, setShowLoginPwd] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [showForgotPassword, setShowForgotPassword] = useState(false)

  // Register state
  const [form, setForm] = useState(emptyRegisterForm())
  const [showRegPwd, setShowRegPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // OTP verification state
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpTimer, setOtpTimer] = useState(0)
  const [verifiedMobile, setVerifiedMobile] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (session) {
      navigate(rolePathMap[session.user.role], { replace: true })
    }
  }, [session, navigate])

  // OTP countdown timer
  useEffect(() => {
    if (otpTimer <= 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setInterval(() => {
      setOtpTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          timerRef.current = null
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [otpTimer > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset OTP state when mobile number changes
  const handleMobileChange = useCallback(
    (value: string) => {
      patchForm('mobileNumber', value)
      if (otpVerified && normalizeMobile(value) !== verifiedMobile) {
        setOtpVerified(false)
        setOtpSent(false)
        setOtpCode('')
        setOtpError(null)
        resetOtpState()
      }
    },
    [otpVerified, verifiedMobile],
  )

  const handleSendOtp = async () => {
    setOtpError(null)
    const mobile = normalizeMobile(form.mobileNumber)
    if (!isValidMobile(mobile)) {
      setOtpError('Please enter a valid 10-digit mobile number.')
      return
    }

    setOtpSending(true)
    try {
      // Check uniqueness first
      const taken = await vendorRegistrationApi.checkMobileUniqueness(mobile)
      if (taken) {
        setOtpError('Mobile number already registered. Please use a different number or sign in.')
        return
      }
      await sendOtp(mobile, 'recaptcha-container')
      setOtpSent(true)
      setOtpTimer(60)
      setOtpCode('')
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Failed to send OTP.')
    } finally {
      setOtpSending(false)
    }
  }

  const handleVerifyOtp = async () => {
    setOtpError(null)
    setOtpVerifying(true)
    try {
      await verifyOtp(otpCode)
      setOtpVerified(true)
      setVerifiedMobile(normalizeMobile(form.mobileNumber))
      setOtpSent(false)
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'OTP verification failed.')
    } finally {
      setOtpVerifying(false)
    }
  }

  const handleResendOtp = () => {
    setOtpCode('')
    setOtpError(null)
    resetOtpState()
    void handleSendOtp()
  }

  if (session) return null

  const toggleTheme = () => setMode(isLight ? 'dark' : 'light')

  const patchForm = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  const onLogin = async (event: FormEvent) => {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError(null)
    try {
      await login(loginId, loginPwd)
    } catch (err) {
      setLoginError(
        err instanceof ApiError
          ? `${err.message} (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Sign-in failed',
      )
      setLoginLoading(false)
    }
  }

  const onRegister = async (event: FormEvent) => {
    event.preventDefault()
    setRegError(null)
    if (!otpVerified) {
      setRegError('Please verify your mobile number with OTP before submitting.')
      return
    }
    if (normalizeMobile(form.mobileNumber) !== verifiedMobile) {
      setRegError('Mobile number was changed after verification. Please verify again.')
      setOtpVerified(false)
      return
    }
    if (form.password !== form.confirmPassword) {
      setRegError('Passwords do not match.')
      return
    }
    if (form.password.length < 8) {
      setRegError('Password must be at least 8 characters.')
      return
    }
    setRegLoading(true)
    try {
      // Check email uniqueness before submitting
      const emailTaken = await vendorRegistrationApi.checkEmailUniqueness(form.email)
      if (emailTaken) {
        setRegError('Email already registered. Please use a different email or sign in.')
        setRegLoading(false)
        return
      }

      const payload: VendorRegistrationPayload = {
        branchId: form.branchId,
        vendorName: form.vendorName,
        companyName: form.companyName,
        mobileNumber: form.mobileNumber,
        email: form.email,
        gstNumber: form.gstNumber,
        address: form.address,
        bankAccountNumber: form.bankAccountNumber,
        bankName: form.bankName,
        ifscCode: form.ifscCode,
        bankBranch: form.bankBranch,
      }
      await vendorRegistrationApi.submit(payload, form.password)
      setSubmitted(true)
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
    } finally {
      setRegLoading(false)
    }
  }

  const cardClass = `group w-full transition-all duration-300 overflow-hidden rounded-[2rem] border p-8 backdrop-blur-xl sm:p-10
    ${tab === 'register' ? 'max-w-2xl' : 'max-w-md'}
    ${
      isLight
        ? 'bg-white/90 border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_0_15px_rgba(20,184,166,0.05)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08),0_0_25px_rgba(20,184,166,0.1)]'
        : 'bg-panel/60 border-info/20 shadow-[0_0_20px_rgba(34,211,238,0.1),0_0_40px_rgba(34,211,238,0.05),inset_0_0_12px_rgba(34,211,238,0.03)] hover:shadow-[0_0_35px_rgba(34,211,238,0.2),0_0_65px_rgba(34,211,238,0.1),inset_0_0_20px_rgba(34,211,238,0.06)] hover:border-info/40'
    }`

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-base font-sans text-text selection:bg-accent/30 transition-colors duration-400">
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
          className={`absolute -left-[10%] -top-[10%] h-[50%] w-[50%] rounded-full transition-opacity duration-700 ${isLight ? 'bg-accent/5 opacity-50' : 'bg-accent/10 opacity-100'} blur-[120px]`}
        />
        <div
          className={`absolute -right-[10%] bottom-[10%] h-[45%] w-[45%] rounded-full transition-opacity duration-700 ${isLight ? 'bg-info/5 opacity-40' : 'bg-info/10 opacity-100'} blur-[120px]`}
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
            <div className="mb-6 flex items-center gap-2">
              <div className="h-2 w-10 rounded-full bg-accent" />
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                Partner Access Portal
              </span>
            </div>

            <img
              src={`${import.meta.env.BASE_URL}${isLight ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
              alt="A Square GoKarting"
              className="h-20 w-auto object-contain sm:h-24 lg:h-28 drop-shadow-lg"
              draggable={false}
            />

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Third-party vendor and partner gateway. Register your business to connect with A
              Square GoKarting operations.
            </p>

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {[
                {
                  label: 'Registration',
                  desc: 'Submit your vendor details for Owner review and approval',
                },
                {
                  label: 'Secure Login',
                  desc: 'Access your partner dashboard after account activation',
                },
                {
                  label: 'Operational Visibility',
                  desc: 'Monitor API health, latency, and incident status',
                },
                {
                  label: 'Integration Support',
                  desc: 'Diagnostics, release checks, and partner-facing telemetry',
                },
              ].map((item, idx) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.2 + idx * 0.1 }}
                  className={`group rounded-2xl border border-border/40 p-4 transition-all hover:border-accent/40 ${isLight ? 'bg-white/80 shadow-sm' : 'bg-panel/40 hover:bg-panel/60'}`}
                >
                  <p className="text-sm font-semibold text-text group-hover:text-accent transition-colors">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xs text-muted">{item.desc}</p>
                </motion.div>
              ))}
            </div>

            <div className="mt-10">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-xs font-semibold text-muted transition-colors hover:text-accent"
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
                Back to employee login
              </Link>
            </div>
          </motion.div>
        </section>

        {/* Right Form Panel */}
        <section className="flex flex-1 items-center justify-center p-6 lg:p-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={cardClass}
          >
            {/* Card Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="font-display text-3xl font-bold text-text">ThirdParty Portal</h2>
                <p className="mt-2 text-sm text-muted">
                  {tab === 'login'
                    ? 'Sign in to your vendor account'
                    : 'Register as a new vendor partner'}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                title={isLight ? 'Turn off lights' : 'Turn on lights'}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-full border border-border/40 transition-all duration-300 ${isLight ? 'bg-warning/10 text-warning' : 'bg-surface text-muted hover:text-text'}`}
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
                        className="h-5 w-5 fill-warning"
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

            {/* Tab Switcher */}
            <div className="mb-6 flex rounded-2xl border border-border/40 bg-surface p-1 gap-1">
              {(['login', 'register'] as PortalTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t)
                    setLoginError(null)
                    setRegError(null)
                    setSubmitted(false)
                  }}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all duration-200 uppercase tracking-widest ${
                    tab === t
                      ? 'bg-accent text-panel shadow-md shadow-accent/20'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {t === 'login' ? 'Login' : 'Register'}
                </button>
              ))}
            </div>

            {/* ── LOGIN TAB ── */}
            <AnimatePresence mode="wait">
              {tab === 'login' && (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <form className="space-y-5" onSubmit={onLogin}>
                    <div className="space-y-2">
                      <label className={labelClass} htmlFor="portal-identifier">
                        Email or Mobile Number
                      </label>
                      <input
                        id="portal-identifier"
                        type="text"
                        autoComplete="username"
                        className={inputClass}
                        value={loginId}
                        onChange={(e) => setLoginId(e.target.value)}
                        placeholder="Enter email or mobile number"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className={labelClass} htmlFor="portal-password">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="portal-password"
                          type={showLoginPwd ? 'text' : 'password'}
                          autoComplete="current-password"
                          className={`${inputClass} pr-14`}
                          value={loginPwd}
                          onChange={(e) => setLoginPwd(e.target.value)}
                          placeholder="••••••••"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowLoginPwd((v) => !v)}
                          className="absolute inset-y-2 right-2 flex items-center justify-center rounded-xl px-3 text-xs font-bold text-muted transition hover:text-accent"
                        >
                          {showLoginPwd ? 'HIDE' : 'SHOW'}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loginLoading}
                      className="group relative w-full overflow-hidden rounded-2xl bg-accent py-4 text-sm font-bold text-panel transition-all hover:translate-y-[-2px] hover:shadow-[0_8px_30px_rgb(var(--color-accent)/0.3)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <span className="relative z-10 uppercase tracking-widest">
                        {loginLoading ? 'Authenticating...' : 'Sign In'}
                      </span>
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                    </button>

                    <div aria-live="polite">
                      {loginError && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-xl border border-critical/20 bg-critical/10 px-4 py-3 text-sm text-critical"
                        >
                          {loginError}
                        </motion.div>
                      )}
                    </div>

                    <div className="mt-3 text-right">
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className="text-xs font-semibold text-accent hover:underline"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  </form>

                  <div className="mt-6 pt-6 border-t border-border/40 text-center">
                    <p className="text-xs text-muted leading-relaxed">
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => setTab('register')}
                        className="font-semibold text-accent hover:underline"
                      >
                        Register as a vendor
                      </button>
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ── REGISTER TAB ── */}
              {tab === 'register' && !submitted && (
                <motion.div
                  key="register"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <form className="space-y-5" onSubmit={onRegister}>
                    {/* Row 1: Branch + Vendor Name */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-branch">
                          Select Branch
                        </label>
                        <select
                          id="reg-branch"
                          className={selectClass}
                          value={form.branchId}
                          onChange={(e) => patchForm('branchId', e.target.value)}
                          required
                        >
                          <option value="" disabled>
                            Select branch...
                          </option>
                          {branchOptions.map((b) => (
                            <option key={b.value} value={b.value}>
                              {b.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-vendor-name">
                          Vendor Name
                        </label>
                        <input
                          id="reg-vendor-name"
                          type="text"
                          className={inputClass}
                          value={form.vendorName}
                          onChange={(e) => patchForm('vendorName', e.target.value)}
                          placeholder="Your name"
                          required
                        />
                      </div>
                    </div>

                    {/* Row 2: Company + Mobile */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-company">
                          Company Name
                        </label>
                        <input
                          id="reg-company"
                          type="text"
                          className={inputClass}
                          value={form.companyName}
                          onChange={(e) => patchForm('companyName', e.target.value)}
                          placeholder="Company / trade name"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-mobile">
                          Mobile Number
                          {otpVerified && (
                            <span className="ml-2 text-[10px] font-bold text-success">
                              VERIFIED
                            </span>
                          )}
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="reg-mobile"
                            type="tel"
                            className={`${inputClass} flex-1`}
                            value={form.mobileNumber}
                            onChange={(e) => handleMobileChange(e.target.value)}
                            placeholder="10-digit mobile"
                            disabled={otpVerified}
                            required
                          />
                          {!otpVerified && !otpSent && (
                            <button
                              type="button"
                              disabled={
                                otpSending || !isValidMobile(normalizeMobile(form.mobileNumber))
                              }
                              onClick={() => void handleSendOtp()}
                              className="shrink-0 rounded-2xl bg-accent px-4 py-2 text-xs font-bold text-panel uppercase tracking-wider transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {otpSending ? 'Sending...' : 'Send OTP'}
                            </button>
                          )}
                        </div>

                        {/* OTP input section */}
                        {otpSent && !otpVerified && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="mt-2 space-y-2"
                          >
                            <div className="flex gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                className={`${inputClass} flex-1 tracking-[0.3em] text-center font-mono`}
                                value={otpCode}
                                onChange={(e) => {
                                  setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                  setOtpError(null)
                                }}
                                placeholder="Enter 6-digit OTP"
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus OTP input on step open
                                autoFocus
                              />
                              <button
                                type="button"
                                disabled={otpVerifying || otpCode.length !== 6}
                                onClick={() => void handleVerifyOtp()}
                                className="shrink-0 rounded-2xl bg-success px-4 py-2 text-xs font-bold text-panel uppercase tracking-wider transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {otpVerifying ? 'Verifying...' : 'Verify'}
                              </button>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted">
                                {otpTimer > 0
                                  ? `Resend OTP in ${otpTimer}s`
                                  : 'Didn\u2019t receive OTP?'}
                              </span>
                              {otpTimer === 0 && (
                                <button
                                  type="button"
                                  onClick={handleResendOtp}
                                  className="font-semibold text-accent hover:underline"
                                >
                                  Resend OTP
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}

                        {otpError && <p className="mt-1 text-xs text-critical">{otpError}</p>}
                      </div>
                    </div>

                    {/* Row 3: Email + GST */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-email">
                          Email
                        </label>
                        <input
                          id="reg-email"
                          type="email"
                          autoComplete="email"
                          className={inputClass}
                          value={form.email}
                          onChange={(e) => patchForm('email', e.target.value)}
                          placeholder="vendor@email.com"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-gst">
                          GST Number <span className="text-muted font-normal">(Optional)</span>
                        </label>
                        <input
                          id="reg-gst"
                          type="text"
                          className={inputClass}
                          value={form.gstNumber}
                          onChange={(e) => patchForm('gstNumber', e.target.value.toUpperCase())}
                          placeholder="GST registration number"
                        />
                      </div>
                    </div>

                    {/* Address: full width */}
                    <div className="space-y-2">
                      <label className={labelClass} htmlFor="reg-address">
                        Address
                      </label>
                      <textarea
                        id="reg-address"
                        rows={2}
                        className="w-full rounded-2xl border border-border/40 bg-surface px-4 py-3.5 text-sm text-text transition-all placeholder:text-muted/60 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10 resize-none"
                        value={form.address}
                        onChange={(e) => patchForm('address', e.target.value)}
                        placeholder="Full business address"
                        required
                      />
                    </div>

                    {/* Row 4: Bank Account + Bank Name */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-bank-account">
                          Bank Account Number
                        </label>
                        <input
                          id="reg-bank-account"
                          type="text"
                          className={inputClass}
                          value={form.bankAccountNumber}
                          onChange={(e) => patchForm('bankAccountNumber', e.target.value)}
                          placeholder="9 – 18 digit number"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-bank-name">
                          Bank Name
                        </label>
                        <input
                          id="reg-bank-name"
                          type="text"
                          className={inputClass}
                          value={form.bankName}
                          onChange={(e) => patchForm('bankName', e.target.value)}
                          placeholder="e.g. HDFC Bank"
                          required
                        />
                      </div>
                    </div>

                    {/* Row 5: IFSC + Branch */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-ifsc">
                          IFSC Code
                        </label>
                        <input
                          id="reg-ifsc"
                          type="text"
                          className={inputClass}
                          value={form.ifscCode}
                          onChange={(e) => patchForm('ifscCode', e.target.value.toUpperCase())}
                          placeholder="e.g. HDFC0001234"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-bank-branch">
                          Bank Branch
                        </label>
                        <input
                          id="reg-bank-branch"
                          type="text"
                          className={inputClass}
                          value={form.bankBranch}
                          onChange={(e) => patchForm('bankBranch', e.target.value)}
                          placeholder="Branch location"
                          required
                        />
                      </div>
                    </div>

                    {/* Row 6: Password + Confirm */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-pwd">
                          Password
                        </label>
                        <div className="relative">
                          <input
                            id="reg-pwd"
                            type={showRegPwd ? 'text' : 'password'}
                            autoComplete="new-password"
                            className={`${inputClass} pr-14`}
                            value={form.password}
                            onChange={(e) => patchForm('password', e.target.value)}
                            placeholder="Min. 8 characters"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPwd((v) => !v)}
                            className="absolute inset-y-2 right-2 flex items-center justify-center rounded-xl px-3 text-xs font-bold text-muted transition hover:text-accent"
                          >
                            {showRegPwd ? 'HIDE' : 'SHOW'}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass} htmlFor="reg-confirm-pwd">
                          Confirm Password
                        </label>
                        <div className="relative">
                          <input
                            id="reg-confirm-pwd"
                            type={showConfirmPwd ? 'text' : 'password'}
                            autoComplete="new-password"
                            className={`${inputClass} pr-14`}
                            value={form.confirmPassword}
                            onChange={(e) => patchForm('confirmPassword', e.target.value)}
                            placeholder="Re-enter password"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPwd((v) => !v)}
                            className="absolute inset-y-2 right-2 flex items-center justify-center rounded-xl px-3 text-xs font-bold text-muted transition hover:text-accent"
                          >
                            {showConfirmPwd ? 'HIDE' : 'SHOW'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Invisible reCAPTCHA container */}
                    <div id="recaptcha-container" />

                    <button
                      type="submit"
                      disabled={regLoading || !otpVerified}
                      className="group relative w-full overflow-hidden rounded-2xl bg-accent py-4 text-sm font-bold text-panel transition-all hover:translate-y-[-2px] hover:shadow-[0_8px_30px_rgb(var(--color-accent)/0.3)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <span className="relative z-10 uppercase tracking-widest">
                        {regLoading
                          ? 'Submitting...'
                          : !otpVerified
                            ? 'Verify Mobile to Submit'
                            : 'Submit Registration'}
                      </span>
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                    </button>

                    <div aria-live="polite">
                      {regError && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-xl border border-critical/20 bg-critical/10 px-4 py-3 text-sm text-critical"
                        >
                          {regError}
                        </motion.div>
                      )}
                    </div>
                  </form>

                  <div className="mt-6 pt-6 border-t border-border/40 text-center">
                    <p className="text-xs text-muted">
                      Already registered?{' '}
                      <button
                        type="button"
                        onClick={() => setTab('login')}
                        className="font-semibold text-accent hover:underline"
                      >
                        Sign in
                      </button>
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ── SUCCESS STATE ── */}
              {tab === 'register' && submitted && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className="py-6 text-center space-y-5"
                >
                  <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-success/30 bg-success/10">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
                    >
                      <svg
                        className="h-10 w-10 text-success"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </motion.div>
                    <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-success/10 blur-md" />
                  </div>

                  <div>
                    <h3 className="font-display text-2xl font-bold text-text">
                      Registration Submitted
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted max-w-sm mx-auto">
                      Your vendor registration has been submitted successfully. The Owner will
                      review your details and activate your account. You will be able to sign in
                      once approved.
                    </p>
                  </div>

                  <div
                    className={`rounded-2xl border border-border/40 p-4 text-left ${isLight ? 'bg-white/70' : 'bg-surface/50'}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                      What happens next?
                    </p>
                    <ul className="space-y-1.5 text-xs text-muted">
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"></span>
                        Owner reviews your registration in the Admin panel
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"></span>
                        On approval, your ThirdParty account is activated
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"></span>
                        Sign in here using your mobile number and the password you set
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() => setTab('login')}
                    className="group relative w-full overflow-hidden rounded-2xl bg-accent py-4 text-sm font-bold text-panel transition-all hover:translate-y-[-2px] hover:shadow-[0_8px_30px_rgb(var(--color-accent)/0.3)] active:translate-y-0"
                  >
                    <span className="relative z-10 uppercase tracking-widest">Go to Login</span>
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </section>
      </div>

      {/* Forgot Password Modal */}
      <AnimatePresence>
        {showForgotPassword && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowForgotPassword(false)
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl ${isLight ? 'border-border/40 bg-white' : 'border-info/20 bg-panel'}`}
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
                <svg
                  className="h-7 w-7 text-accent"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-text">Password Assistance</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                For password assistance, please contact A Square technical support.
              </p>
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="mt-5 w-full rounded-2xl bg-accent py-3 text-sm font-bold text-panel transition-all hover:translate-y-[-1px] hover:shadow-lg"
              >
                Got It
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}

export default ThirdPartyPortalPage
