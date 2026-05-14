/**
 * Capacitor Module Mocks — PRODUCTION SAFETY
 *
 * Stubs all Capacitor native modules so tests run in pure jsdom
 * without any native platform calls.
 */

import { vi } from 'vitest'

export const capacitorCoreMock = {
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
    isPluginAvailable: vi.fn(() => false),
    convertFileSrc: vi.fn((src: string) => src),
  },
  registerPlugin: vi.fn(() => ({})),
}

export const capacitorPreferencesMock = {
  Preferences: {
    get: vi.fn(() => Promise.resolve({ value: null })),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
    keys: vi.fn(() => Promise.resolve({ keys: [] })),
  },
}

export function registerCapacitorMocks() {
  vi.mock('@capacitor/core', () => capacitorCoreMock)
  vi.mock('@capacitor/preferences', () => capacitorPreferencesMock)
}
