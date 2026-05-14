/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useTheme hook co-located */
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { ResolvedTheme, ThemeMode } from '../../api/types'

const STORAGE_KEY = 'pipeline-theme'

interface ThemeContextValue {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  cycleMode: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const loadThemeMode = (): ThemeMode => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'light' || raw === 'dark') {
    return raw
  }
  return 'dark'
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => loadThemeMode())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => loadThemeMode())

  useEffect(() => {
    setResolvedTheme(mode)
    localStorage.setItem(STORAGE_KEY, mode)

    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(mode)
  }, [mode])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode: (nextMode: ThemeMode) => setModeState(nextMode),
      cycleMode: () => {
        setModeState((current) => (current === 'light' ? 'dark' : 'light'))
      },
    }),
    [mode, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
