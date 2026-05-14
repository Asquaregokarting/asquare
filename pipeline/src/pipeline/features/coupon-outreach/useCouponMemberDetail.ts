import { useCallback, useEffect, useState } from 'react'
import { couponOutreachApi, type CouponOutreachItem } from '../../api/coupon-outreach'
import { useAuth } from '../auth/auth-context'
import { logger } from '../../../lib/logger'

/**
 * Loads a single coupon-outreach item by phone for the slide-over detail
 * view. Refreshes when the parent passes a new phone or calls `refresh`.
 */
export const useCouponMemberDetail = (dateStr: string, phone: string | null) => {
  const { session } = useAuth()
  const token = session?.token ?? ''
  const [item, setItem] = useState<CouponOutreachItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token || !phone) {
      setItem(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await couponOutreachApi.getItem(token, dateStr, phone)
      setItem(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load member'
      logger.error('coupon_outreach.detail_load_failed', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [token, dateStr, phone])

  useEffect(() => {
    void load()
  }, [load])

  return { item, loading, error, refresh: load }
}
