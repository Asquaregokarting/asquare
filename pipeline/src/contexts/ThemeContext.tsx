/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useTheme hook co-located */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Customer app theme context.
 *
 * Mirrors the pipeline ThemeProvider so both halves of the app share a single
 * mental model: a `mode` ("light" | "dark" | "system") that resolves to a
 * concrete theme that gets stamped on `<html>` as a class.
 *
 * Tailwind is configured with `darkMode: 'class'` so adding `.dark` to the
 * root element activates every `dark:*` utility.
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'asquare_theme_mode'

function loadMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'dark'
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => loadMode())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveMode(loadMode()))

  // Apply class to <html> and persist whenever mode changes.
  useEffect(() => {
    const next = resolveMode(mode)
    setResolvedTheme(next)
    window.localStorage.setItem(STORAGE_KEY, mode)
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(next)
  }, [mode])

  // React to OS-level dark mode changes when in 'system' mode.
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setResolvedTheme(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode: setModeState,
      toggle: () => setModeState((current) => (resolveMode(current) === 'dark' ? 'light' : 'dark')),
    }),
    [mode, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
