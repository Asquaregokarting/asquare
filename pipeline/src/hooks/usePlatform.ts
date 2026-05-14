import { useMemo } from 'react'
import { getCurrentPlatform, type AppPlatform } from '../lib/platform'

export function usePlatform(): { platform: AppPlatform } {
  const platform = useMemo(() => getCurrentPlatform(), [])
  return { platform }
}
