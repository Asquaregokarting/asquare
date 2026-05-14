/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useToast hook co-located */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export type ToastType = 'error' | 'success' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

interface ToastContextValue {
  toasts: ToastItem[]
  error: (message: string) => void
  success: (message: string) => void
  info: (message: string) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const MAX_TOASTS = 5
let nextId = 0

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((type: ToastType, message: string) => {
    const id = String(++nextId)
    setToasts((prev) => {
      const next = [{ id, type, message }, ...prev]
      return next.length > MAX_TOASTS ? next.slice(0, MAX_TOASTS) : next
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const error = useCallback((msg: string) => push('error', msg), [push])
  const success = useCallback((msg: string) => push('success', msg), [push])
  const info = useCallback((msg: string) => push('info', msg), [push])

  return (
    <ToastContext.Provider value={{ toasts, error, success, info, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
