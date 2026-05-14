import { FormEvent, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ApiError } from "../api/client";
import { useAuth } from "../features/auth/auth-context";
import { rolePathMap } from "../features/dashboard/role-config";
import { useTheme } from "../features/theme/theme-context";

const roleHints = [
  { role: "Owner and Admin", desc: "monitor cross-team operations" },
  { role: "Telecaller and Developer", desc: "sign in with Firestore email, username, or user ID" },
  { role: "Cashier and Track Marshall", desc: "run shift-critical workflows" },
  { role: "Editor, Backend, and Third party", desc: "execute media and technical pipelines" }
];

const LoginPage = () => {
  const { session, login } = useAuth();
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);

  const isLight = mode === "light";

  const toggleTheme = () => {
    setMode(isLight ? "dark" : "light");
  };

  useEffect(() => {
    if (session && !showSuccessAnimation) {
      // If already logged in, redirect normally
      navigate(rolePathMap[session.user.role], { replace: true });
    }
  }, [session, navigate, showSuccessAnimation]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(identifier, password);
      setShowSuccessAnimation(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.message} (${err.status})`);
      } else {
        setError(err instanceof Error ? err.message : "Sign-in failed");
      }
      setLoading(false);
    }
  };

  // Handle navigation after animation
  useEffect(() => {
    if (showSuccessAnimation && session) {
      const timer = setTimeout(() => {
        navigate(rolePathMap[session.user.role], { replace: true });
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [showSuccessAnimation, session, navigate]);

  if (session && !showSuccessAnimation) {
    return null; // Let the useEffect handle redirection
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-base font-sans text-text selection:bg-accent/30 transition-colors duration-400">
      {/* Visual Light Sources (Radial Gradients) for Light Mode */}
      <AnimatePresence>
        {isLight && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          >
            {/* Soft Warm Light Sources at the Top */}
            <div 
              className="absolute left-[20%] -top-[10%] h-[500px] w-[800px] rounded-full blur-[120px] opacity-40"
              style={{ background: 'radial-gradient(circle, #facc15 0%, transparent 70%)' }}
            />
            <div 
              className="absolute right-[10%] -top-[5%] h-[400px] w-[600px] rounded-full blur-[100px] opacity-30"
              style={{ background: 'radial-gradient(circle, #fde68a 0%, transparent 70%)' }}
            />
            <div 
              className="absolute left-[50%] -top-[15%] h-[350px] w-[500px] -translate-x-1/2 rounded-full blur-[90px] opacity-20"
              style={{ background: 'radial-gradient(circle, #fefce8 0%, transparent 70%)' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layered Background Gradients (Standard) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute -left-[10%] -top-[10%] h-[50%] w-[50%] rounded-full transition-opacity duration-700 ${isLight ? 'bg-accent/5 opacity-50' : 'bg-accent/10 opacity-100'} blur-[120px]`} />
        <div className={`absolute -right-[10%] bottom-[10%] h-[45%] w-[45%] rounded-full transition-opacity duration-700 ${isLight ? 'bg-info/5 opacity-40' : 'bg-info/10 opacity-100'} blur-[120px]`} />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col lg:flex-row">
        {/* Branding Panel */}
        <section className="flex flex-1 flex-col justify-center p-8 lg:p-16 xl:p-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-6 flex items-center gap-2">
              <div className="h-2 w-10 rounded-full bg-accent" />
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Invite-Only Platform</span>
            </div>
            
            <img
              src={`${import.meta.env.BASE_URL}${isLight ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
              alt="A Square GoKarting"
              className="h-20 w-auto object-contain sm:h-24 lg:h-28 drop-shadow-lg"
              draggable={false}
            />
            
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Unified operational command layer for digital leads, workforce shifts, billing, track operations, and
              collaborative task execution.
            </p>

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {roleHints.map((hint, idx) => (
                <motion.div
                  key={hint.role}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.2 + idx * 0.1 }}
                  className={`group rounded-2xl border border-border/40 p-4 transition-all hover:border-accent/40 ${isLight ? 'bg-white/80 shadow-sm' : 'bg-panel/40 hover:bg-panel/60'}`}
                >
                  <p className="text-sm font-semibold text-text group-hover:text-accent transition-colors">
                    {hint.role}
                  </p>
                  <p className="mt-1 text-xs text-muted">{hint.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* Auth Form Panel */}
        <section className="flex flex-1 items-center justify-center p-6 lg:p-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={`group w-full max-w-md overflow-hidden rounded-[2rem] border p-8 backdrop-blur-xl sm:p-10 transition-all duration-300
              ${isLight 
                ? 'bg-white/90 border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_0_15px_rgba(20,184,166,0.05)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08),0_0_25px_rgba(20,184,166,0.1)]' 
                : 'bg-panel/60 border-info/20 shadow-[0_0_20px_rgba(34,211,238,0.1),0_0_40px_rgba(34,211,238,0.05),inset_0_0_12px_rgba(34,211,238,0.03)] hover:shadow-[0_0_35px_rgba(34,211,238,0.2),0_0_65px_rgba(34,211,238,0.1),inset_0_0_20px_rgba(34,211,238,0.06)] hover:border-info/40'
              }`}
          >
            <div className="flex items-start justify-between mb-8">
              <div>
                <h2 className="font-display text-3xl font-bold text-text">Secure Login</h2>
                <p className="mt-2 text-sm text-muted">Enter your credentials to continue</p>
              </div>
              
              {/* Theme Toggle - Visual Light Switch */}
              <button
                type="button"
                onClick={toggleTheme}
                title={isLight ? "Turn off lights" : "Turn on lights"}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-full border border-border/40 transition-all duration-300 ${isLight ? 'bg-warning/10 text-warning' : 'bg-surface text-muted hover:text-text'}`}
              >
                <AnimatePresence mode="wait">
                  {isLight ? (
                    <motion.div
                      key="sun"
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: 90 }}
                      className="relative"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 fill-warning shadow-warning/40" viewBox="0 0 24 24">
                        <path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm0-9V3a1 1 0 0 0-2 0v3a1 1 0 0 0 2 0zm0 15v3a1 1 0 0 0 2 0v-3a1 1 0 0 0-2 0zM5.64 6.64a1 1 0 0 0 0-1.41l-2.12-2.12a1 1 0 0 0-1.41 1.41l2.12 2.12a1 1 0 0 0 1.41 0zm14.85 14.85a1 1 0 0 0 0-1.41l-2.12-2.12a1 1 0 0 0-1.41 1.41l2.12 2.12a1 1 0 0 0 1.41 0zM3 12a1 1 0 0 0 0-2H1a1 1 0 0 0 0 2zm20-2h-2a1 1 0 0 0 0 2h2a1 1 0 0 0 0-2zm-2.51-4.73-2.12 2.12a1 1 0 0 0 1.41 1.41l2.12-2.12a1 1 0 0 0-1.41-1.41zM6.64 18.36a1 1 0 0 0-1.41 0l-2.12 2.12a1 1 0 0 0 1.41 1.41l2.12-2.12a1 1 0 0 0 0-1.41z"/>
                      </svg>
                      {/* Glow effect for sun */}
                      <div className="absolute inset-0 -z-10 animate-pulse bg-warning/40 blur-md rounded-full" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="moon"
                      initial={{ scale: 0, rotate: 90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: -90 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-60 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3a9 9 0 1 0 9 9 9.75 9.75 0 0 0-.46-2.82 1 1 0 0 0-1.28-.58 1 1 0 0 0-.58 1.28 7.75 7.75 0 1 1-6.13-6.13 1 1 0 0 0 1.28-.58 1 1 0 0 0-.58-1.28A9.75 9.75 0 0 0 12 3z"/>
                      </svg>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </div>

            <form className="space-y-5" onSubmit={onSubmit}>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted" htmlFor="identifier">
                  Email, Username, or Phone Number
                </label>
                <input
                  id="identifier"
                  autoComplete="username"
                  className="w-full rounded-2xl border border-border/40 bg-surface px-4 py-3.5 text-sm text-text transition-all placeholder:text-muted/60 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  type="text"
                  placeholder="Enter email, username, or phone number"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    autoComplete="current-password"
                    className="w-full rounded-2xl border border-border/40 bg-surface px-4 py-3.5 pr-14 text-sm text-text transition-all placeholder:text-muted/60 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-2 right-2 flex items-center justify-center rounded-xl px-3 text-xs font-bold text-muted transition hover:text-accent"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full overflow-hidden rounded-2xl bg-accent py-4 text-sm font-bold text-panel transition-all hover:translate-y-[-2px] hover:shadow-[0_8px_30px_rgb(var(--color-accent)/0.3)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="relative z-10 uppercase tracking-widest">
                  {loading ? "Authenticating..." : "Sign In"}
                </span>
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
              </button>

              <div aria-live="polite">
                {error ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-critical/20 bg-critical/10 px-4 py-3 text-sm text-critical"
                  >
                    {error}
                  </motion.div>
                ) : null}
              </div>
            </form>

            <div className="mt-8 pt-8 border-t border-border/40 space-y-4">
              <p className="text-center text-xs leading-relaxed text-muted">
                This platform is invite-only. Employee accounts are created only by the Owner or Admin.
              </p>
              <Link
                to="/third-party"
                className={`flex w-full items-center justify-center gap-2.5 rounded-2xl border border-border/40 py-3 text-xs font-semibold uppercase tracking-widest text-muted transition-all hover:border-accent/40 hover:text-accent ${isLight ? "bg-white/60 hover:bg-white/80" : "hover:bg-surface/60"}`}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Third Party / Vendor Access
              </Link>
            </div>
          </motion.div>
        </section>
      </div>

      {/* Success Transition Overlay */}
      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-base"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="relative flex items-center justify-center"
            >
              {/* Glowing circular light */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute h-64 w-64 rounded-full border-2 border-accent/20"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute h-72 w-72 rounded-full border border-accent/10 border-t-accent/40"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: [0, 1, 0.5, 1], scale: [0.5, 1.2, 1, 1.1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute h-80 w-80 rounded-full bg-accent/5 blur-3xl"
              />
              
              <img
                src={`${import.meta.env.BASE_URL}${isLight ? 'asquare-logo-light.webp' : 'asquare-logo.webp'}`}
                alt="A Square GoKarting"
                className="relative z-10 h-16 w-auto object-contain sm:h-20 drop-shadow-2xl"
                draggable={false}
              />
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-8 flex items-center gap-3"
            >
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '150ms' }} />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: '300ms' }} />
              <span className="ml-2 text-xs font-bold tracking-[0.2em] text-accent/80 uppercase">Initialising Dashboard</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
};

export default LoginPage;

