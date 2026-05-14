import { useCallback, useEffect, useState } from 'react'
import { feedbackCallsApi } from '../../api/feedback-calls'
import type { FeedbackCallRecord, ListFeedbackCallsFilter } from '../../api/types'
import { useAuth } from '../auth/auth-context'
import type { FeedbackCallFilters } from './useFeedbackCallFilters'

export const useFeedbackCallList = (filters: FeedbackCallFilters) => {
  const { session } = useAuth()
  const [calls, setCalls] = useState<FeedbackCallRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<string | undefined>()

  const token = session?.token ?? ''

  const loadCalls = useCallback(
    async (append = false) => {
      if (!token) return
      setLoading(true)
      setError(null)
      try {
        const apiFilter: ListFeedbackCallsFilter = {
          status: filters.status,
          branchId: filters.branchId,
          assignedTo: filters.assignedTo,
          fromDate: filters.fromDate,
          toDate: filters.toDate,
          cursor: append ? cursor : undefined,
        }
        const result = await feedbackCallsApi.list(token, apiFilter)

        let filtered = result.calls
        // Client-side text search on the current page (name / phone)
        if (filters.search) {
          const q = filters.search.toLowerCase()
          filtered = filtered.filter(
            (c) =>
              c.customerName.toLowerCase().includes(q) ||
              c.customerPhone.includes(q) ||
              (c.customerEmail?.toLowerCase().includes(q) ?? false),
          )
        }

        if (append) {
          setCalls((prev) => [...prev, ...filtered])
        } else {
          setCalls(filtered)
        }
        setHasMore(result.hasMore)
        if (result.calls.length > 0) {
          setCursor(result.calls[result.calls.length - 1].callDate)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feedback calls')
      } finally {
        setLoading(false)
      }
    },
    [token, filters, cursor],
  )

  // Reload when filters change
  useEffect(() => {
    setCursor(undefined)
    void loadCalls(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    filters.status,
    filters.branchId,
    filters.assignedTo,
    filters.fromDate,
    filters.toDate,
    filters.search,
  ])

  const loadMore = useCallback(() => loadCalls(true), [loadCalls])
  const refresh = useCallback(() => {
    setCursor(undefined)
    void loadCalls(false)
  }, [loadCalls])

  return { calls, loading, error, hasMore, loadMore, refresh }
}
