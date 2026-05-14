import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
  }
}

export default function GTMTracker() {
  const location = useLocation()

  useEffect(() => {
    // Send a custom page_view event to the GTM dataLayer
    if (typeof window !== 'undefined' && window.dataLayer) {
      window.dataLayer.push({
        event: 'page_view',
        page: location.pathname + location.search,
      })
    }
  }, [location])

  return null // This component doesn't render anything
}
