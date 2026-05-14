import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, CheckCircle2, AlertCircle, QrCode, Clock } from 'lucide-react'
import { Html5Qrcode } from 'html5-qrcode'
import { useAuth } from '../../../features/auth/auth-context'
import { kartfluencerApi } from '../../../api/kartfluencer'

interface ScanResult {
  id: string
  handle: string
  timestamp: string
  success: boolean
  error?: string
}

const SCANNER_ELEMENT_ID = 'kartfluencer-qr-scanner'

const KartfluencerScannerView = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''

  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<ScanResult | null>(null)
  const [recentScans, setRecentScans] = useState<ScanResult[]>([])
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const processingRef = useRef(false)

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop()
      }
      scannerRef.current?.clear()
    } catch {
      // ignore stop errors
    }
    scannerRef.current = null
    setScanning(false)
  }, [])

  const handleScanSuccess = useCallback(
    async (decodedText: string) => {
      if (!token || processingRef.current) return
      processingRef.current = true
      setProcessing(true)
      setError('')

      try {
        const result = await kartfluencerApi.markVisitedByQR(token, decodedText)
        const scanEntry: ScanResult = {
          id: result.influencerId,
          handle: result.handle,
          timestamp: new Date().toISOString(),
          success: true,
        }
        setLastScan(scanEntry)
        setRecentScans((prev) => [scanEntry, ...prev].slice(0, 20))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to process QR code'
        const scanEntry: ScanResult = {
          id: crypto.randomUUID?.() ?? Date.now().toString(),
          handle: 'Unknown',
          timestamp: new Date().toISOString(),
          success: false,
          error: message,
        }
        setLastScan(scanEntry)
        setRecentScans((prev) => [scanEntry, ...prev].slice(0, 20))
        setError(message)
      } finally {
        setProcessing(false)
        processingRef.current = false
      }
    },
    [token],
  )

  const startScanner = useCallback(async () => {
    setError('')
    setLastScan(null)

    try {
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID)
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          void handleScanSuccess(decodedText)
        },
        () => {
          // QR code not found in frame — no-op
        },
      )

      setScanning(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Camera access denied or unavailable'
      setError(message)
      setScanning(false)
    }
  }, [handleScanSuccess])

  // Clean up scanner on unmount
  useEffect(() => {
    return () => {
      void stopScanner()
    }
  }, [stopScanner])

  const toggleScanner = async () => {
    if (scanning) {
      await stopScanner()
    } else {
      await startScanner()
    }
  }

  return (
    <div className="ui-section-stack">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text">QR Visit Scanner</h2>
          <p className="text-xs text-muted mt-0.5">
            Scan influencer QR codes to mark branch visits
          </p>
        </div>
        <button
          onClick={() => void toggleScanner()}
          className={`ui-btn ${scanning ? 'ui-btn-neutral' : 'ui-btn-primary'} text-xs gap-1.5`}
        >
          {scanning ? (
            <>
              <CameraOff size={14} /> Stop Scanner
            </>
          ) : (
            <>
              <Camera size={14} /> Start Scanner
            </>
          )}
        </button>
      </div>

      {/* Error message */}
      {error && !lastScan?.error && (
        <div className="rounded-xl border border-critical/40 bg-critical/10 px-4 py-3 flex items-start gap-2">
          <AlertCircle size={16} className="text-critical mt-0.5 shrink-0" />
          <p className="text-sm text-critical">{error}</p>
        </div>
      )}

      {/* Scanner viewport */}
      <div className="flex flex-col items-center gap-4">
        <div
          className={`w-full max-w-md rounded-2xl border-2 overflow-hidden transition-colors ${
            scanning ? 'border-accent bg-[#020617]' : 'border-border/50 bg-surface/50'
          }`}
        >
          <div id={SCANNER_ELEMENT_ID} className="w-full" />
          {!scanning && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <QrCode size={48} className="text-muted/40" />
              <p className="text-sm text-muted">Camera preview will appear here</p>
            </div>
          )}
        </div>

        {processing && <div className="text-sm text-muted animate-pulse">Processing scan...</div>}
      </div>

      {/* Last scan result */}
      {lastScan && (
        <div
          className={`rounded-xl border px-4 py-4 ${
            lastScan.success
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
              : 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/30'
          }`}
        >
          <div className="flex items-center gap-3">
            {lastScan.success ? (
              <CheckCircle2 size={24} className="text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle size={24} className="text-red-600 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-semibold ${lastScan.success ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'}`}
              >
                {lastScan.success ? 'Visit Marked Successfully' : 'Scan Failed'}
              </p>
              {lastScan.success ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                  Influencer <span className="font-medium">{lastScan.handle}</span> has been marked
                  as visited.
                </p>
              ) : (
                <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{lastScan.error}</p>
              )}
              <p className="text-[10px] text-muted mt-1">
                {new Date(lastScan.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recent scans */}
      {recentScans.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
            <Clock size={14} className="text-muted" /> Recent Scans
          </h3>
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 bg-surface/80">
                  <th className="px-3 py-2.5 text-left font-medium text-muted">Handle</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted">Time</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentScans.map((scan) => (
                  <tr
                    key={scan.id + scan.timestamp}
                    className="border-b border-border/30 hover:bg-surface/60 transition-colors"
                  >
                    <td className="px-3 py-2.5 font-medium text-text">{scan.handle}</td>
                    <td className="px-3 py-2.5 text-muted">
                      {new Date(scan.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2.5">
                      {scan.success ? (
                        <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700">
                          Success
                        </span>
                      ) : (
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-700"
                          title={scan.error}
                        >
                          Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default KartfluencerScannerView
