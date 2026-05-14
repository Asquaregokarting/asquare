/* eslint-disable react-refresh/only-export-components -- entry file: bootstrap code only, no HMR concern */
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import './index.css'

import ErrorBoundary from './components/ErrorBoundary'

// Customer app imports
import { AuthProvider } from './contexts/AuthContext'
import { BookingProvider } from './contexts/BookingContext'
import { GamesProvider } from './contexts/GamesContext'
import { CartProvider } from './contexts/CartContext'
import { ThemeProvider } from './contexts/ThemeContext'
import CustomerApp from './CustomerApp'

// Pipeline admin app (lazy loaded - only loaded on admin subdomain)
const PipelineApp = lazy(() => import('./PipelineApp'))

// React Query defaults are too aggressive for this app: every tab refocus
// re-fetches and `staleTime: 0` means cache is treated as stale immediately,
// causing duplicate Firestore reads on every navigation. We tune them to
// match the app's mostly-read-mostly-static data shape.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — most lookups are safe to reuse
      gcTime: 30 * 60 * 1000, // 30 min — keep cached results around for nav
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
})

/**
 * Detect if we're on the pipeline app.
 * Matches: pipeline.localhost, pipeline.asquaregokarting.com, or ?app=pipeline query param.
 */
const isPipelineHost = (): boolean => {
  const hostname = window.location.hostname
  const searchParams = new URLSearchParams(window.location.search)

  // Check query param for local dev: ?app=pipeline
  if (searchParams.get('app') === 'pipeline') return true

  // Check pipeline subdomain (works for localhost and production)
  if (hostname.startsWith('pipeline.')) return true

  return false
}

const isPipeline = isPipelineHost()

const LoadingFallback = () => (
  <div
    style={{
      display: 'grid',
      placeItems: 'center',
      minHeight: '100vh',
      fontSize: '14px',
      color: '#666',
      backgroundColor: '#f5f5f5',
    }}
  >
    Loading...
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          {isPipeline ? (
            <ErrorBoundary scope="pipeline">
              <Suspense fallback={<LoadingFallback />}>
                <PipelineApp />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <ErrorBoundary scope="customer">
              <ThemeProvider>
                <AuthProvider>
                  <BookingProvider>
                    <GamesProvider>
                      <CartProvider>
                        <CustomerApp />
                      </CartProvider>
                    </GamesProvider>
                  </BookingProvider>
                </AuthProvider>
              </ThemeProvider>
            </ErrorBoundary>
          )}
        </BrowserRouter>
      </QueryClientProvider>
    </HelmetProvider>
  </StrictMode>,
)
