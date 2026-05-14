// A² Scanner — QRScannerView.tsx
// Uses html5-qrcode to scan QR codes from device camera

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { requestCameraPermission } from '../../../../lib/native-permissions'

interface QRScannerViewProps {
  onScanSuccess: (billingId: string) => void
  onClose: () => void
}

type ScannerStatus = 'requesting' | 'starting' | 'active' | 'denied' | 'stopped'

export const QRScannerView = ({ onScanSuccess, onClose }: QRScannerViewProps) => {
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ScannerStatus>('requesting')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)
  const hasScannedRef = useRef(false)
  const containerId = 'qr-scanner-container'

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState()
        if (state === 2 /* SCANNING */) {
          await scannerRef.current.stop()
        }
        scannerRef.current.clear()
      } catch {
        // ignore errors during cleanup
      }
      scannerRef.current = null
    }
    setStatus('stopped')
  }, [])

  const startScanner = useCallback(
    async (cancelled: { current: boolean }) => {
      // Step 1: Request camera permission (handles Android/iOS native + web)
      setStatus('requesting')
      setError(null)

      const permissionState = await requestCameraPermission()

      if (cancelled.current) return

      if (permissionState === 'denied') {
        setError(
          'Camera permission was denied. Please allow camera access in your device settings and try again.',
        )
        setStatus('denied')
        return
      }

      // Step 2: Start html5-qrcode scanner
      setStatus('starting')

      const { Html5Qrcode } = await import('html5-qrcode')
      if (cancelled.current) return

      const scanner = new Html5Qrcode(containerId)
      scannerRef.current = scanner

      const WIDTH = Math.min(window.innerWidth * 0.8, 280)

      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: WIDTH, height: WIDTH } },
          (decodedText) => {
            if (hasScannedRef.current) return
            hasScannedRef.current = true
            void stopScanner().then(() => {
              const trimmed = decodedText.trim()
              onScanSuccess(trimmed)
            })
          },
          undefined, // suppress verbose errors from html5-qrcode
        )
        .then(() => {
          if (!cancelled.current) setStatus('active')
        })
        .catch((err: unknown) => {
          if (cancelled.current) return
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('NotAllowedError') || msg.includes('Permission denied')) {
            setError(
              'Camera permission was denied. Please allow camera access in your browser settings and reload.',
            )
            setStatus('denied')
          } else {
            setError(`Camera access failed: ${msg}`)
            setStatus('denied')
          }
        })
    },
    [onScanSuccess, stopScanner],
  )

  useEffect(() => {
    const cancelled = { current: false }
    void startScanner(cancelled)

    return () => {
      cancelled.current = true
      void stopScanner()
    }
  }, [startScanner, stopScanner])

  const handleRetry = () => {
    hasScannedRef.current = false
    const cancelled = { current: false }
    void startScanner(cancelled)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-track-panel/95 p-4 backdrop-blur-md"
    >
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Scan QR Code</h2>
            <p className="text-sm text-white/50">Point camera at the booking QR code</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void stopScanner().then(onClose)
            }}
            className="rounded-full border border-white/10 p-2 text-white/60 transition-colors hover:border-white/30 hover:text-white"
          >
            <svg
              className="size-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scanner box */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
          {(status === 'starting' || status === 'requesting') && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-track-panel">
              <div className="flex flex-col items-center gap-3 text-white/50">
                <svg className="size-8 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-sm">
                  {status === 'requesting' ? 'Requesting camera access...' : 'Starting Camera...'}
                </span>
              </div>
            </div>
          )}

          <div id={containerId} style={{ width: '100%', minHeight: 300 }} />

          {/* Scanning overlay corners */}
          {status === 'active' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative" style={{ width: '70%', aspectRatio: '1' }}>
                <span className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-track-accent" />
                <span className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-track-accent" />
                <span className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-track-accent" />
                <span className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-track-accent" />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-signal-red-hot/30 bg-signal-red-hot/10 px-4 py-3">
            <p className="text-sm text-signal-red-hot">{error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-2 rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
            >
              Try Again
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-white/30">
          QR code will be processed automatically when detected.
        </p>
      </div>
    </motion.div>
  )
}
