import { useEffect, useMemo, useState } from 'react'
import type { UserRecord } from '../../api/types'
import { listFirestoreUsers } from '../../api/users-firestore'
import { logger } from '../../../lib/logger'

interface UseTelecallersResult {
  telecallers: UserRecord[]
  nameById: Map<string, string>
  loading: boolean
}

// Loads the Telecaller roster once (the underlying users-firestore call is
// memoized via usersCache, so multiple consumers share the fetch). Used to
// resolve assignee userIds to display names on lead cards and to populate
// assignee filter dropdowns.
export const useTelecallers = (): UseTelecallersResult => {
  const [telecallers, setTelecallers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listFirestoreUsers({ role: 'Telecaller' })
      .then((users) => {
        if (cancelled) return
        const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name))
        setTelecallers(sorted)
      })
      .catch((err) => {
        logger.error('telecallers.load_failed', err)
        if (!cancelled) setTelecallers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of telecallers) map.set(u.id, u.name)
    return map
  }, [telecallers])

  return { telecallers, nameById, loading }
}
