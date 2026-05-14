import { describe, it, expect } from 'vitest'
import {
  __cleanEventDataForTest as cleanEventData,
  __mapPackagesForTest as mapPackages,
} from './event-campaigns-firestore'

describe('event-campaigns-firestore — write→read round trip', () => {
  it('preserves printIndividualTokens=true through write and read', () => {
    const written = cleanEventData({
      packages: [
        {
          id: 'pkg-1',
          title: 'Combo',
          locationKey: 'visakhapatnam',
          items: [
            {
              id: 'item-1',
              type: 'company',
              name: 'Helicopter Ride',
              price: 1500,
              printIndividualTokens: true,
            },
          ],
        },
      ],
    })

    const round = mapPackages(written.packages)
    expect(round[0].items[0].printIndividualTokens).toBe(true)
  })

  it('drops printIndividualTokens when undefined (so unchecking persists)', () => {
    const written = cleanEventData({
      packages: [
        {
          id: 'pkg-1',
          title: 'Combo',
          locationKey: 'visakhapatnam',
          items: [
            {
              id: 'item-1',
              type: 'company',
              name: 'Go-Kart',
              price: 500,
              printIndividualTokens: undefined,
            },
          ],
        },
      ],
    })

    expect(
      'printIndividualTokens' in (written.packages as Record<string, unknown>[])[0].items[0],
    ).toBe(false)
    const round = mapPackages(written.packages)
    expect(round[0].items[0].printIndividualTokens).toBeUndefined()
  })

  it('preserves package locationKey through round trip', () => {
    const written = cleanEventData({
      packages: [
        {
          id: 'pkg-1',
          title: 'Combo',
          locationKey: 'kakinada',
          items: [{ id: 'i', type: 'company', name: 'Game', price: 100 }],
        },
      ],
    })

    const round = mapPackages(written.packages)
    expect(round[0].locationKey).toBe('kakinada')
  })

  it('preserves package.enabled=false (paused state)', () => {
    const written = cleanEventData({
      packages: [
        {
          id: 'pkg-1',
          title: 'Combo',
          locationKey: 'visakhapatnam',
          items: [],
          enabled: false,
        },
      ],
    })

    const round = mapPackages(written.packages)
    expect(round[0].enabled).toBe(false)
  })

  it('preserves item.enabled=false (paused state)', () => {
    const written = cleanEventData({
      packages: [
        {
          id: 'pkg-1',
          title: 'Combo',
          locationKey: 'visakhapatnam',
          items: [
            {
              id: 'i',
              type: 'company',
              name: 'Game',
              price: 100,
              enabled: false,
            },
          ],
        },
      ],
    })

    const round = mapPackages(written.packages)
    expect(round[0].items[0].enabled).toBe(false)
  })

  it('preserves vendorId, revenueShare, printIndividualTokens together', () => {
    const written = cleanEventData({
      packages: [
        {
          id: 'pkg-1',
          title: 'Combo',
          locationKey: 'visakhapatnam',
          items: [
            {
              id: 'i',
              type: 'thirdParty',
              name: 'Helicopter',
              price: 1500,
              vendorId: 'vendor-7',
              revenueShare: true,
              printIndividualTokens: true,
            },
          ],
        },
      ],
    })

    const round = mapPackages(written.packages)
    expect(round[0].items[0].vendorId).toBe('vendor-7')
    expect(round[0].items[0].revenueShare).toBe(true)
    expect(round[0].items[0].printIndividualTokens).toBe(true)
  })

  it('strips top-level undefined (e.g. interaktTemplateId left blank)', () => {
    const written = cleanEventData({
      title: 'Sale',
      interaktTemplateId: undefined,
      interaktTemplateLanguage: undefined,
    })
    expect('interaktTemplateId' in written).toBe(false)
    expect('interaktTemplateLanguage' in written).toBe(false)
    expect(written.title).toBe('Sale')
  })
})
