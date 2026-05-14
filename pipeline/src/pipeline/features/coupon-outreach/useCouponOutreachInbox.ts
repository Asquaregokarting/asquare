import { useCallback, useEffect, useState } from 'react'
import {
  couponOutreachApi,
  type CouponOutreachBatch,
  type CouponOutreachItem,
  type CouponOutreachStatus,
} from '../../api/coupon-outreach'
import { useAuth } from '../auth/auth-context'
import { logger } from '../../../lib/logger'

/**
 * Hook for the telecaller "My Calls" inbox view. Loads today's assigned
 * items, exposes status-update mutations, and refreshes optimistically.
 *
 * Mirrors the structure of features/leads/useLeadList + useLeadActions but
 * scoped exclusively to coupon outreach data — never touches the leads API.
 */
export const useCouponOutreachInbox = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''

  const [batch, setBatch] = useState<CouponOutreachBatch | null>(null)
  const [items, setItems] = useState<CouponOutreachItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) {
      setBatch(null)
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await couponOutreachApi.listMyAssignments(token)
      setBatch(result.batch)
      setItems(result.items)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load inbox'
      logger.error('coupon_outreach.inbox_load_failed', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const updateStatus = useCallback(
    async (phone: string, status: CouponOutreachStatus, note?: string): Promise<void> => {
      if (!token || !batch) return
      setBusy(true)
      setActionError(null)
      try {
        const updated = await couponOutreachApi.updateItemStatus(
          token,
          batch.date,
          phone,
          status,
          note,
        )
        setItems((prev) => prev.map((it) => (it.phone === phone ? { ...it, ...updated } : it)))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Update failed'
        logger.error('coupon_outreach.update_status_failed', err)
        setActionError(msg)
      } finally {
        setBusy(false)
      }
    },
    [token, batch],
  )

  return {
    batch,
    items,
    loading,
    error,
    busy,
    actionError,
    refresh: load,
    updateStatus,
  }
}
