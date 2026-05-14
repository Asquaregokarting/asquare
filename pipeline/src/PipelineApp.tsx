import { useEffect } from 'react'
import { ThemeProvider } from './pipeline/features/theme/theme-context'
import { AuthProvider } from './pipeline/features/auth/auth-context'
import { ToastProvider } from './pipeline/features/toast/toast-context'
import ToastContainer from './pipeline/features/toast/ToastContainer'
import { PipelineRoutes } from './pipeline/app/router'
import { ensureFirebaseAuthForStorage } from './pipeline/lib/firebase-auth'
import './pipeline/styles/globals.css'

function PipelineApp() {
  // Ensure anonymous Firebase Auth on app load so all Firestore writes
  // satisfy security rules requiring request.auth != null.
  useEffect(() => {
    ensureFirebaseAuthForStorage().catch(() => undefined)
  }, [])

  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <PipelineRoutes />
        </AuthProvider>
        <ToastContainer />
      </ToastProvider>
    </ThemeProvider>
  )
}

export default PipelineApp
