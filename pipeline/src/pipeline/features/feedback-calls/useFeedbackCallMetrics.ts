import { useCallback, useEffect, useState } from 'react'
import { feedbackCallsApi } from '../../api/feedback-calls'
import type { FeedbackMetricsFilter } from '../../api/feedback-calls'
import type { FeedbackCallMetrics } from '../../api/types'
import { useAuth } from '../auth/auth-context'

export const useFeedbackCallMetrics = (filter?: FeedbackMetricsFilter) => {
  const { session } = useAuth()
  const [metrics, setMetrics] = useState<FeedbackCallMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const token = session?.token ?? ''

  const fromDate = filter?.fromDate
  const toDate = filter?.toDate
  const branchId = filter?.branchId

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await feedbackCallsApi.getMetrics(token, { fromDate, toDate, branchId })
      setMetrics(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feedback metrics')
    } finally {
      setLoading(false)
    }
  }, [token, fromDate, toDate, branchId])

  useEffect(() => {
    void load()
  }, [load])

  return { metrics, loading, error, refresh: load }
}
