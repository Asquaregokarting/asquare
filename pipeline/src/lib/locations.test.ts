import { describe, it, expect, vi } from 'vitest'

vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}))

import {
  getAllLocations,
  getEnabledLocations,
  getLocationBySlug,
  getLocationByBranchId,
  getLocationByDisplayName,
  resolveLocation,
  slugToBranchId,
  branchIdToSlug,
  branchIdToDisplayName,
  getLocationDisplayName,
  getLocationShortName,
  normalizeLocationId,
  normalizeStoredLocation,
  getSlugToBranchIdMap,
  getBranchIdToSlugMap,
  getBranchIdToDisplayNameMap,
} from './locations'

describe('locations — static fallback data', () => {
  it('getAllLocations returns non-empty array', () => {
    const locs = getAllLocations()
    expect(locs.length).toBeGreaterThan(0)
    expect(locs[0]).toHaveProperty('slug')
    expect(locs[0]).toHaveProperty('branchId')
    expect(locs[0]).toHaveProperty('displayName')
  })

  it('getEnabledLocations filters by enabled', () => {
    const enabled = getEnabledLocations()
    expect(enabled.every((l) => l.enabled)).toBe(true)
  })

  it('all locations have required fields', () => {
    for (const loc of getAllLocations()) {
      expect(loc.slug).toBeTruthy()
      expect(loc.branchId).toBeTruthy()
      expect(loc.displayName).toBeTruthy()
      expect(loc.shortName).toBeTruthy()
      expect(typeof loc.enabled).toBe('boolean')
    }
  })
})

describe('locations — slug lookups', () => {
  it('getLocationBySlug finds by canonical slug', () => {
    const loc = getLocationBySlug('visakhapatnam')
    expect(loc).toBeTruthy()
    expect(loc?.branchId).toBe('0')
  })

  it('getLocationBySlug is case-insensitive', () => {
    expect(getLocationBySlug('Visakhapatnam')).toBeTruthy()
    expect(getLocationBySlug('KAKINADA')).toBeTruthy()
  })

  it('getLocationBySlug resolves legacy alias "vizag"', () => {
    const loc = getLocationBySlug('vizag')
    expect(loc).toBeTruthy()
    expect(loc?.slug).toBe('visakhapatnam')
  })

  it('getLocationBySlug returns undefined for unknown', () => {
    expect(getLocationBySlug('nonexistent')).toBeUndefined()
  })
})

describe('locations — branchId lookups', () => {
  it('getLocationByBranchId finds by ID', () => {
    const loc = getLocationByBranchId('0')
    expect(loc).toBeTruthy()
    expect(loc?.slug).toBe('visakhapatnam')
  })

  it('getLocationByBranchId returns undefined for unknown', () => {
    expect(getLocationByBranchId('999')).toBeUndefined()
  })
})

describe('locations — display name lookups', () => {
  it('getLocationByDisplayName finds by full name', () => {
    const loc = getLocationByDisplayName('Visakhapatnam')
    expect(loc).toBeTruthy()
  })

  it('getLocationByDisplayName finds by short name', () => {
    const loc = getLocationByDisplayName('Vizag')
    expect(loc).toBeTruthy()
    expect(loc?.slug).toBe('visakhapatnam')
  })
})

describe('resolveLocation — multi-strategy', () => {
  it('resolves by slug', () => {
    expect(resolveLocation('kakinada')?.branchId).toBe('1')
  })

  it('resolves by branchId', () => {
    expect(resolveLocation('0')?.slug).toBe('visakhapatnam')
  })

  it('resolves by display name', () => {
    expect(resolveLocation('Rajahmundry')?.branchId).toBe('2')
  })

  it('returns undefined for unknown', () => {
    expect(resolveLocation('mars')).toBeUndefined()
  })
})

describe('locations — conversion helpers', () => {
  it('slugToBranchId converts slug to branchId', () => {
    expect(slugToBranchId('visakhapatnam')).toBe('0')
    expect(slugToBranchId('kakinada')).toBe('1')
  })

  it('slugToBranchId returns input for unknown slug', () => {
    expect(slugToBranchId('unknown')).toBe('unknown')
  })

  it('branchIdToSlug converts branchId to slug', () => {
    expect(branchIdToSlug('0')).toBe('visakhapatnam')
    expect(branchIdToSlug('1')).toBe('kakinada')
  })

  it('branchIdToSlug returns input for unknown id', () => {
    expect(branchIdToSlug('999')).toBe('999')
  })

  it('branchIdToDisplayName converts id to name', () => {
    expect(branchIdToDisplayName('0')).toBe('Visakhapatnam')
  })

  it('getLocationDisplayName works with slug or id', () => {
    expect(getLocationDisplayName('visakhapatnam')).toBe('Visakhapatnam')
    expect(getLocationDisplayName('0')).toBe('Visakhapatnam')
  })

  it('getLocationShortName returns short name', () => {
    expect(getLocationShortName('visakhapatnam')).toBe('Vizag')
    expect(getLocationShortName('0')).toBe('Vizag')
  })

  it('normalizeLocationId normalizes variants', () => {
    expect(normalizeLocationId('vizag')).toBe('0')
    expect(normalizeLocationId('0')).toBe('0')
    expect(normalizeLocationId('Visakhapatnam')).toBe('0')
  })
})

describe('locations — map getters', () => {
  it('getSlugToBranchIdMap returns valid map', () => {
    const map = getSlugToBranchIdMap()
    expect(map.visakhapatnam).toBe('0')
    expect(map.kakinada).toBe('1')
  })

  it('getBranchIdToSlugMap returns valid map', () => {
    const map = getBranchIdToSlugMap()
    expect(map['0']).toBe('visakhapatnam')
  })

  it('getBranchIdToDisplayNameMap returns valid map', () => {
    const map = getBranchIdToDisplayNameMap()
    expect(map['0']).toBe('Visakhapatnam')
  })
})

describe('normalizeStoredLocation', () => {
  it('returns null when localStorage is empty', () => {
    localStorage.removeItem('test_key')
    expect(normalizeStoredLocation('test_key')).toBeNull()
  })

  it('normalizes stored value', () => {
    localStorage.setItem('test_loc', 'vizag')
    const result = normalizeStoredLocation('test_loc')
    expect(result).toBe('0')
    // Should overwrite localStorage with normalized value
    expect(localStorage.getItem('test_loc')).toBe('0')
  })

  it('returns raw value for unresolvable locations', () => {
    localStorage.setItem('test_loc2', 'mars')
    // When value can't be resolved, it's returned as-is (not null)
    const result = normalizeStoredLocation('test_loc2')
    expect(typeof result).toBe('string')
  })
})
