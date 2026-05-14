import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { vendorDiscrepanciesApi } from '../pipeline/api/vendor-discrepancies'
import { generateVendorDiscrepancyHtml } from '../pipeline/features/vendor-attribution/discrepancyReport'
import type { VendorDiscrepancyRecord } from '../pipeline/api/types'

/**
 * Public page rendered by the WhatsApp / email link in a vendor discrepancy
 * notice. Reads the record by reference and renders the same HTML the Owner
 * previewed in the Discrepancies tab — no auth required, lookup is by
 * unguessable reference id (e.g. "DISC-2026-0414-001").
 */
const VendorDiscrepancyReport = () => {
  const { reference } = useParams<{ reference: string }>()
  const [record, setRecord] = useState<VendorDiscrepancyRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!reference) {
        setError('not-found')
        setLoading(false)
        return
      }
      try {
        const result = await vendorDiscrepanciesApi.getByReference(reference)
        if (cancelled) return
        if (!result) setError('not-found')
        else setRecord(result)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load notice')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [reference])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-950 text-sm text-dark-300">
        Loading notice…
      </div>
    )
  }

  if (error === 'not-found' || !record) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-dark-950 px-6 text-center text-white">
        <h1 className="text-lg font-bold">Notice Not Found</h1>
        <p className="text-sm text-dark-300">
          This discrepancy reference does not exist or has been retracted.
        </p>
      </div>
    )
  }

  // Render the generated HTML in an iframe so its inline styles can't leak
  // into / collide with the customer-app stylesheet, and the page looks
  // exactly like the static preview Owners see in the admin tab.
  const html = generateVendorDiscrepancyHtml(record)
  return (
    <iframe
      title={`Vendor Discrepancy Notice ${record.reference}`}
      srcDoc={html}
      className="h-screen w-full border-0"
    />
  )
}

export default VendorDiscrepancyReport
