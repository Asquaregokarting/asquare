import { Capacitor } from '@capacitor/core'

export type AppPlatform = 'web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings'

export const ALL_PLATFORMS: AppPlatform[] = ['web', 'windows', 'android', 'ios', 'pos', 'bookings']

let cachedPlatform: AppPlatform | null = null

export function getCurrentPlatform(): AppPlatform {
  if (cachedPlatform) return cachedPlatform

  const capacitorPlatform = Capacitor.getPlatform()

  if (capacitorPlatform === 'ios') {
    cachedPlatform = 'ios'
  } else if (capacitorPlatform === 'android') {
    cachedPlatform = 'android'
  } else if (
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Electron')
  ) {
    cachedPlatform = 'windows'
  } else {
    cachedPlatform = 'web'
  }

  return cachedPlatform
}

/**
 * Returns true if the current platform is included in the given platforms list.
 * If platforms is undefined or empty, the item is available on all platforms (backward compatible).
 */
export function isPlatformAvailable(platforms?: AppPlatform[]): boolean {
  if (!platforms || platforms.length === 0) return true
  return platforms.includes(getCurrentPlatform())
}
