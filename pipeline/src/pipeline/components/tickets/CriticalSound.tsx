import { useEffect, useRef } from 'react'
import { useTicketNotifications } from '../../features/tickets/use-ticket-notifications'

const SOUND_URL = '/sounds/ticket-critical.mp3' // ship this asset under public/sounds/

export const CriticalSound = () => {
  const { items } = useTicketNotifications()
  const lastSeenRef = useRef<string | null>(null)

  useEffect(() => {
    if (items.length === 0) return
    const top = items[0]
    if (top.read || top.priority !== 'Critical') {
      lastSeenRef.current = top.id
      return
    }
    if (lastSeenRef.current === top.id) return
    lastSeenRef.current = top.id
    try {
      const audio = new Audio(SOUND_URL)
      audio.volume = 0.6
      void audio.play().catch(() => undefined)
    } catch {
      /* autoplay policies — best effort */
    }
  }, [items])

  return null
}
