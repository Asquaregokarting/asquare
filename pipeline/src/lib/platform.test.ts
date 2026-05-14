import { describe, it, expect, vi } from 'vitest'

// Mock Capacitor — setup.ts already mocks it as 'web' platform
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'web',
    isNativePlatform: () => false,
  },
}))

import { getCurrentPlatform, isPlatformAvailable, ALL_PLATFORMS } from './platform'

describe('ALL_PLATFORMS', () => {
  it('contains all expected platforms', () => {
    expect(ALL_PLATFORMS).toContain('web')
    expect(ALL_PLATFORMS).toContain('windows')
    expect(ALL_PLATFORMS).toContain('android')
    expect(ALL_PLATFORMS).toContain('ios')
    expect(ALL_PLATFORMS).toContain('pos')
    expect(ALL_PLATFORMS).toContain('bookings')
    expect(ALL_PLATFORMS).toHaveLength(6)
  })
})

describe('getCurrentPlatform', () => {
  it('returns web in test environment', () => {
    expect(getCurrentPlatform()).toBe('web')
  })
})

describe('isPlatformAvailable', () => {
  it('returns true when platforms is undefined', () => {
    expect(isPlatformAvailable(undefined)).toBe(true)
  })

  it('returns true when platforms is empty array', () => {
    expect(isPlatformAvailable([])).toBe(true)
  })

  it('returns true when current platform is included', () => {
    expect(isPlatformAvailable(['web', 'android'])).toBe(true)
  })

  it('returns false when current platform is excluded', () => {
    expect(isPlatformAvailable(['android', 'ios'])).toBe(false)
  })

  it('returns true for single matching platform', () => {
    expect(isPlatformAvailable(['web'])).toBe(true)
  })

  it('returns false for single non-matching platform', () => {
    expect(isPlatformAvailable(['pos'])).toBe(false)
  })
})
