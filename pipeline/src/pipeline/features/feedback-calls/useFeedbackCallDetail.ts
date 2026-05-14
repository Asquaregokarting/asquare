import { useCallback, useEffect, useState } from 'react'
import { feedbackCallsApi } from '../../api/feedback-calls'
import type { FeedbackCallRecord } from '../../api/types'
import { useAuth } from '../auth/auth-context'

export const useFeedbackCallDetail = (callId: string | null) => {
  const { session } = useAuth()
  const [call, setCall] = useState<FeedbackCallRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const token = session?.token ?? ''

  const load = useCallback(async () => {
    if (!token || !callId) {
      setCall(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await feedbackCallsApi.get(token, callId)
      setCall(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feedback call')
    } finally {
      setLoading(false)
    }
  }, [token, callId])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(() => {
    void load()
  }, [load])

  return { call, loading, error, refresh }
}
