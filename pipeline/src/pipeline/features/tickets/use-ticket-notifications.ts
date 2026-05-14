import { useEffect, useState } from 'react'
import { useAuth } from '../auth/auth-context'
import {
  subscribeToMyTicketNotifications,
  markNotificationRead,
} from '../../api/ticket-notifications'
import type { TicketNotification } from '../../api/types'

export function useTicketNotifications() {
  const { session } = useAuth()
  const [items, setItems] = useState<TicketNotification[]>([])

  useEffect(() => {
    if (!session) return
    const unsub = subscribeToMyTicketNotifications(session.user.id, setItems, () => {})
    return () => unsub()
  }, [session])

  return {
    items,
    unreadCount: items.filter((n) => !n.read).length,
    markRead: markNotificationRead,
  }
}
