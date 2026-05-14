import { useCallback, useEffect, useState } from 'react'
import { leadsApi, type ListLeadsFilter } from '../../api/leads'
import type { LeadRecord } from '../../api/types'
import { useAuth } from '../auth/auth-context'
import type { LeadFilters } from './useLeadFilters'

export const useLeadList = (filters: LeadFilters, options?: { pageSize?: number }) => {
  const { session } = useAuth()
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<string | undefined>()

  const token = session?.token ?? ''
  const pageSize = options?.pageSize

  const loadLeads = useCallback(
    async (append = false) => {
      if (!token) return
      setLoading(true)
      setError(null)
      try {
        const apiFilter: ListLeadsFilter = {
          status: filters.status,
          assignedTo: filters.assignedTo,
          branchId: filters.branchId,
          source: filters.source,
          scoreLabel: filters.scoreLabel,
          cursor: append ? cursor : undefined,
          pageSize,
        }
        const result = await leadsApi.list(token, apiFilter)

        let filtered = result.leads
        // Client-side text search on the current page
        if (filters.search) {
          const q = filters.search.toLowerCase()
          filtered = filtered.filter(
            (l) =>
              l.customerName.toLowerCase().includes(q) ||
              l.customerPhone.includes(q) ||
              (l.customerEmail?.toLowerCase().includes(q) ?? false),
          )
        }
        // Client-side date range filter
        if (filters.dateFrom) {
          filtered = filtered.filter((l) => l.createdAt >= filters.dateFrom!)
        }
        if (filters.dateTo) {
          filtered = filtered.filter((l) => l.createdAt <= filters.dateTo! + 'T23:59:59')
        }

        if (append) {
          setLeads((prev) => [...prev, ...filtered])
        } else {
          setLeads(filtered)
        }
        setHasMore(result.hasMore)
        if (result.leads.length > 0) {
          setCursor(result.leads[result.leads.length - 1].createdAt)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load leads')
      } finally {
        setLoading(false)
      }
    },
    [token, filters, cursor, pageSize],
  )

  // Reload when filters change
  useEffect(() => {
    setCursor(undefined)
    void loadLeads(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    filters.status,
    filters.assignedTo,
    filters.branchId,
    filters.source,
    filters.scoreLabel,
    filters.search,
    filters.dateFrom,
    filters.dateTo,
    pageSize,
  ])

  const loadMore = useCallback(() => loadLeads(true), [loadLeads])
  const refresh = useCallback(() => {
    setCursor(undefined)
    void loadLeads(false)
  }, [loadLeads])

  return { leads, loading, error, hasMore, loadMore, refresh }
}
