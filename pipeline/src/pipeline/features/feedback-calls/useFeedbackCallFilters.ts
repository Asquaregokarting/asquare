import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FeedbackCallStatus } from '../../api/types'

export interface FeedbackCallFilters {
  status?: FeedbackCallStatus
  branchId?: string
  assignedTo?: string
  fromDate?: string // YYYY-MM-DD inclusive
  toDate?: string // YYYY-MM-DD inclusive
  search?: string
}

const read = (params: URLSearchParams, key: string): string | undefined => {
  const val = params.get(key)?.trim()
  return val || undefined
}

export const useFeedbackCallFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters: FeedbackCallFilters = useMemo(
    () => ({
      status: read(searchParams, 'fcStatus') as FeedbackCallStatus | undefined,
      branchId: read(searchParams, 'fcBranch'),
      assignedTo: read(searchParams, 'fcAssignedTo'),
      fromDate: read(searchParams, 'fcFrom'),
      toDate: read(searchParams, 'fcTo'),
      search: read(searchParams, 'fcSearch'),
    }),
    [searchParams],
  )

  const setFilter = useCallback(
    (key: keyof FeedbackCallFilters, value: string | undefined) => {
      const next = new URLSearchParams(searchParams)
      const paramKey = (
        {
          status: 'fcStatus',
          branchId: 'fcBranch',
          assignedTo: 'fcAssignedTo',
          fromDate: 'fcFrom',
          toDate: 'fcTo',
          search: 'fcSearch',
        } as const
      )[key]
      if (value) {
        next.set(paramKey, value)
      } else {
        next.delete(paramKey)
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const resetFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    for (const key of ['fcStatus', 'fcBranch', 'fcAssignedTo', 'fcFrom', 'fcTo', 'fcSearch']) {
      next.delete(key)
    }
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  return { filters, setFilter, resetFilters }
}
