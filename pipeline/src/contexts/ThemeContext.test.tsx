import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeContext'
import type { ReactNode } from 'react'

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.removeItem('asquare_theme_mode')
    document.documentElement.classList.remove('light', 'dark')
  })

  it('throws when used outside provider', () => {
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used within ThemeProvider')
  })

  it('defaults to dark mode', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('dark')
    expect(result.current.resolvedTheme).toBe('dark')
  })

  it('applies dark class to <html>', () => {
    renderHook(() => useTheme(), { wrapper })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setMode switches to light', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.setMode('light'))
    expect(result.current.mode).toBe('light')
    expect(result.current.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists mode to localStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.setMode('light'))
    expect(localStorage.getItem('asquare_theme_mode')).toBe('light')
  })

  it('restores mode from localStorage', () => {
    localStorage.setItem('asquare_theme_mode', 'light')
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('light')
    expect(result.current.resolvedTheme).toBe('light')
  })

  it('toggle switches dark → light', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.resolvedTheme).toBe('dark')
    act(() => result.current.toggle())
    expect(result.current.resolvedTheme).toBe('light')
  })

  it('toggle switches light → dark', () => {
    localStorage.setItem('asquare_theme_mode', 'light')
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.toggle())
    expect(result.current.resolvedTheme).toBe('dark')
  })

  it('system mode resolves based on matchMedia', () => {
    // The global matchMedia mock returns { matches: false } by default,
    // but the effect runs after the mock might have been restored.
    // Ensure matchMedia is available during the effect.
    const mq = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
    window.matchMedia = vi.fn().mockReturnValue(mq)

    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.setMode('system'))
    expect(result.current.mode).toBe('system')
    // matches: false → resolves to light
    expect(result.current.resolvedTheme).toBe('light')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('asquare_theme_mode', 'rainbow')
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('dark') // falls back to default
  })
})
