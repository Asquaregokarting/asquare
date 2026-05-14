import { db } from '../lib/firebase'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import type { Activity } from '../types'
import { listFirestoreActivityHierarchy } from '../pipeline/api/activities-firestore'
import type { ActivityGameTreeRecord } from '../pipeline/api/types'
import { isPlatformAvailable } from '../lib/platform'
import { isCurrentlyUnavailable } from '../pipeline/api/activity-availability'
import { logger } from '../lib/logger'

// Variant metadata shape for soft-availability extraction. Variants store the
// flag fields on their `metadata` blob; this helper unwraps them into the
// structural shape that `isCurrentlyUnavailable` expects.
const variantUnavailable = (metadata: Record<string, unknown> | undefined): boolean =>
  isCurrentlyUnavailable({
    temporarilyUnavailable: metadata?.temporarilyUnavailable === true,
    temporarilyUnavailableUntil:
      typeof metadata?.temporarilyUnavailableUntil === 'string'
        ? metadata.temporarilyUnavailableUntil
        : undefined,
  })

export interface Category {
  id: string
  name: string
  image: string
  description: string
}

const GAME_IMAGE_BASE = 'https://asquaregokarting.com/admin_secure/images/games'
const GAME_IMAGE_MAP: Record<string, string> = {
  archery: 'archery 1x1.jpg',
  'big baller': 'BIG BALLER 1x1.jpg',
  'bouncy slide': 'Bouncy Slide 1x1.jpg',
  'bungee basket ball': 'BUNGEE BASKET BALL 1x1.jpg',
  cricket: 'cricket 1x1.jpg',
  'giant dart': 'Giant Dart 1x1.jpg',
  gokarting: 'gokarting 1x1.jpg',
  'hippo chow down': 'Hippo Chow Down 1x1.jpg',
  'human gyro': 'Human Gyro 1x1.jpg',
  'ice cream cup ride': 'ICE CREAM CUP RIDE 1x1.jpg',
  'mechanical bull': 'mechanical bull 1x1.jpg',
  meltdown: 'meltdown 1x1.jpg',
  'paddler boat': 'Paddler Boat 1x1.jpg',
  paintball: 'paintball 1x1.jpg',
  'rifle shooting': 'rifle shooting 1x1.jpg',
  'rocket ejector': 'rocket ejector 1x1.jpg',
  'soapy foose ball': 'Soapy Foose Ball 1x1.jpg',
  'sumo fight': 'SUMO FIGHT 1x1.jpg',
  trampoline: 'trampoline 1x1.jpg',
  'bungee trampoline': 'Bungee Trampoline 1x1.jpg',
  'trampoline park': 'Trampoline park 1x1.jpg',
  zipline: 'zipline.jpg',
  zorbing: 'Zorbing 1x1.jpg',
  'vr world': 'VR World 1x1.jpg',
  'baby car': 'Baby car 1x1.jpg',
  'giant swing': 'GIANT SWING 1x1.jpg',
  'haunted house': 'Haunted house 1x1.jpg',
}

const EXCLUDED_TERMS = [
  'dayout',
  'day out',
  'kartinfluencer',
  'rock climbing',
  'indian kitchen',
  'robotic massage',
  '5 laps',
  '4am',
  'photo shoot',
  'exchange',
  'ik gokarting',
  'open token',
  'junior',
  'cub',
  'kids',
  'pro racing',
  'testing',
  '10%off',
  '10% off',
  'tendem',
  'sky rolling',
  'single zipline 2 persons',
  'bicycle zipline 2',
  '15 overs',
  '25 overs',
  'snooker',
  'remote cars',
  'velcro wall',
  'wire buzz',
  'socks',
  'cyber x 2 player + catch me if you can',
  'cyber x 2 player + slide + snatch it',
  'side + game box + catch me if you can',
  'cyber x 1 player + slide + game box + snatch it 2 player',
  'giant swing 3 pass combo',
  'giant swing 5 pass combo',
]

function isExcluded(text: string): boolean {
  const lowerText = (text || '').toLowerCase()
  return EXCLUDED_TERMS.some((term) => {
    // Use word boundaries for terms that look like they should be specific (e.g. '5 laps')
    if (term.includes('laps') || term.includes('min') || term.includes('overs')) {
      const regex = new RegExp(`\\b${term}\\b`, 'i')
      return regex.test(lowerText)
    }
    return lowerText.includes(term)
  })
}

// Get image URL from relative path or direct name mapping
function getImageUrl(imagePath: string, name?: string): string {
  if (name) {
    const cleanLowerName = name.toLowerCase().replace(/[\s-]/g, '')
    const entries = Object.entries(GAME_IMAGE_MAP).sort((a, b) => b[0].length - a[0].length)

    // 1. Try exact mapping first
    const exactMatch = entries.find(([key]) => {
      const cleanKey = key.toLowerCase().replace(/[\s-]/g, '')
      return cleanLowerName === cleanKey
    })?.[1]

    if (exactMatch) return `${GAME_IMAGE_BASE}/${exactMatch}`

    // 2. Try partial mapping (name contains the key)
    const partialMatch = entries.find(([key]) => {
      const cleanKey = key.toLowerCase().replace(/[\s-]/g, '')
      return cleanLowerName.includes(cleanKey)
    })?.[1]

    if (partialMatch) {
      return `${GAME_IMAGE_BASE}/${partialMatch}`
    }
  }

  if (!imagePath) return ''
  if (imagePath.startsWith('http')) return imagePath
  // Clean up path
  const cleanPath = imagePath.replace('../', '').replace('..\\', '')
  return `https://asquaregokarting.com/${cleanPath}`
}

const CATEGORY_SORT_ORDER = [
  'gokarting',
  'kart',
  'helicopter',
  'paintball',
  'paint ball',
  'zipline',
  'meltdown',
  'rocket ejector',
  'cricket',
  'rifle shooting',
  'shooting',
  'mechanical bull',
  'bull',
  'archery',
  'trampoline',
]

// Fetch game types (categories) from pipeline Firestore
export async function getGameTypes(locationId: string): Promise<Category[]> {
  try {
    const locations = await listFirestoreActivityHierarchy(locationId)
    const location = locations[0]

    if (!location || !location.games.length) {
      logger.warn('activity.no_games_in_pipeline', { locationId })
      return []
    }

    const result = location.games
      .filter(
        (game: ActivityGameTreeRecord) =>
          game.status === 'Active' &&
          !isExcluded(game.name) &&
          isPlatformAvailable(game.platforms) &&
          // Suppress category card when every active variant across every
          // subgame is temporarily unavailable. Without this, the customer
          // taps "Soapy Foose Ball" and lands on an empty list — confusing
          // and erodes trust. As soon as one variant is restored, the card
          // reappears via the same predicate.
          game.subGames.some((sg) =>
            sg.variants.some((v) => v.active && !variantUnavailable(v.metadata)),
          ),
      )
      .sort((a: ActivityGameTreeRecord, b: ActivityGameTreeRecord) => {
        const aName = (a.name || '').toLowerCase()
        const bName = (b.name || '').toLowerCase()

        const aIndex = CATEGORY_SORT_ORDER.findIndex((term) => aName.includes(term))
        const bIndex = CATEGORY_SORT_ORDER.findIndex((term) => bName.includes(term))

        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
        if (aIndex !== -1) return -1
        if (bIndex !== -1) return 1
        return 0
      })
      .map(
        (game: ActivityGameTreeRecord): Category => ({
          id: game.id,
          name: game.name,
          image: game.imageUrl || getImageUrl('', game.name) || '',
          description:
            (game.metadata?.shortDescription as string) ||
            (game.metadata?.longDescription as string) ||
            '',
        }),
      )

    // Mock Helicopter Category (if not present)
    const hasHelicopter = result.some(
      (c: Category) => c.id === 'helicopter-cat' || c.name.toLowerCase().includes('helicopter'),
    )

    if (
      !hasHelicopter &&
      (locationId === '1' || locationId === '2' || locationId === '3' || locationId === '0')
    ) {
      result.unshift({
        id: 'helicopter',
        name: 'Helicopter',
        image: '/helicopter-banner-placeholder.jpg',
        description: 'Experience the thrill of flying',
      })
    }

    return result
  } catch (error) {
    logger.error('activity.fetch_game_types_failed', error)
    return []
  }
}

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
type CacheEntry = {
  data: Activity[]
  timestamp: number
}
const activitiesCache = new Map<string, CacheEntry>()

// Shared cache for the raw `activities` Firestore collection. Previously
// `getGames` and `getHelicopterAvailableDates` each ran their own
// `getDocs(collection(db,'activities'))` on every page load — that meant the
// activities collection (potentially hundreds of docs) was read twice per
// page mount. We dedupe through this cache so a single 5-min window only
// hits Firestore once. Concurrent callers share the same in-flight promise.
let _rawActivitiesCache: { data: Activity[]; timestamp: number } | null = null
let _rawActivitiesInflight: Promise<Activity[]> | null = null

async function fetchAllActivitiesCached(): Promise<Activity[]> {
  if (_rawActivitiesCache && Date.now() - _rawActivitiesCache.timestamp < CACHE_DURATION) {
    return _rawActivitiesCache.data
  }
  if (_rawActivitiesInflight) return _rawActivitiesInflight

  _rawActivitiesInflight = (async () => {
    const snapshot = await getDocs(collection(db, 'activities'))
    const activities = snapshot.docs.map((doc) => {
      const data = doc.data ? doc.data() : doc
      return { ...data, id: data.id || doc.id } as Activity
    })
    _rawActivitiesCache = { data: activities, timestamp: Date.now() }
    return activities
  })().finally(() => {
    _rawActivitiesInflight = null
  })
  return _rawActivitiesInflight
}

// Fetch games (activities)
export async function getGames(locationId: string, gameTypeId?: string): Promise<Activity[]> {
  try {
    const cacheKey = `${locationId}-${gameTypeId || 'all'}`
    const cached = activitiesCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      // Return cached data immediately
      logger.info('activity.cache_hit', { cacheKey })
      return cached.data
    }

    // Fetch main-app Firestore activities (helicopter, special items) from
    // the shared raw cache so concurrent callers / repeated mounts don't
    // re-scan the entire collection.
    const rawActivities = await fetchAllActivitiesCached()
    const firestoreActivities = rawActivities
      .map((a) => {
        const activity = { ...a }
        if (!activity.gameTypeId && activity.category) {
          activity.gameTypeId = activity.category.trim().toLowerCase()
        }
        return activity
      })
      // Hide both permanently-unavailable (`available: false`) and currently
      // flagged legacy items (helicopter, specials), honoring auto-expire on
      // the soft flag. "Helicopter is closed for the weekend" sets `until`
      // and auto-restores Monday without manual intervention.
      .filter((a) => a.available && !isCurrentlyUnavailable(a))

    // Fetch games from pipeline Firestore hierarchy
    const locations = await listFirestoreActivityHierarchy(locationId)
    const location = locations[0]

    const resultActivities: Activity[] = []
    const otherActivities: Activity[] = []

    if (location && location.games.length > 0) {
      const gokartingGroups: Record<
        string,
        {
          name: string
          gameId: string
          imageUrl: string | undefined
          platforms: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[] | undefined
          shortDescription: string | undefined
          longDescription: string | undefined
          items: { laps: number; price: number; apiId: string }[]
        }
      > = {
        adult: {
          name: 'Gokarting Adult',
          gameId: '',
          imageUrl: undefined,
          platforms: undefined,
          shortDescription: undefined,
          longDescription: undefined,
          items: [],
        },
        child: {
          name: 'Gokarting Child',
          gameId: '',
          imageUrl: undefined,
          platforms: undefined,
          shortDescription: undefined,
          longDescription: undefined,
          items: [],
        },
        double: {
          name: 'Gokarting Double',
          gameId: '',
          imageUrl: undefined,
          platforms: undefined,
          shortDescription: undefined,
          longDescription: undefined,
          items: [],
        },
      }

      for (const game of location.games) {
        if (game.status !== 'Active') continue

        const lowerGameName = game.name.toLowerCase()
        const isGokart = lowerGameName.includes('kart')

        if (isGokart) {
          // Process gokarting: group by subGame type (adult/child/double)
          for (const subGame of game.subGames) {
            // Sub-game level visibility filtering
            const sgMeta = subGame.metadata as Record<string, unknown> | undefined
            const sgPlatforms =
              Array.isArray(sgMeta?.platforms) && (sgMeta!.platforms as string[]).length > 0
                ? (sgMeta!.platforms as (
                    | 'web'
                    | 'windows'
                    | 'android'
                    | 'ios'
                    | 'pos'
                    | 'bookings'
                  )[])
                : game.platforms
            if (!isPlatformAvailable(sgPlatforms)) continue
            const sgLocationKeys =
              Array.isArray(sgMeta?.locationKeys) && (sgMeta!.locationKeys as string[]).length > 0
                ? (sgMeta!.locationKeys as string[])
                : null
            if (sgLocationKeys && !sgLocationKeys.includes(locationId)) continue

            const lowerSubName = subGame.name.toLowerCase()
            let type = 'adult'
            if (lowerSubName.includes('child') || /200\s?cc/i.test(lowerSubName)) {
              type = 'child'
            } else if (lowerSubName.includes('double')) {
              type = 'double'
            }

            if (gokartingGroups[type]) {
              if (!gokartingGroups[type].gameId) {
                gokartingGroups[type].gameId = game.id
                gokartingGroups[type].imageUrl = game.imageUrl
                gokartingGroups[type].platforms = game.platforms
                gokartingGroups[type].shortDescription =
                  (typeof game.metadata?.shortDescription === 'string' &&
                    game.metadata.shortDescription) ||
                  undefined
                gokartingGroups[type].longDescription =
                  (typeof game.metadata?.longDescription === 'string' &&
                    game.metadata.longDescription) ||
                  undefined
              }
              for (const variant of subGame.variants) {
                if (!variant.active || !variant.laps) continue
                // Hide currently-unavailable variants (machine maintenance,
                // staff shortage; auto-expire honored). When ALL of a game's
                // variants are flagged, the gokarting group ends up with zero
                // items and the card is naturally suppressed below.
                if (variantUnavailable(variant.metadata)) continue
                const existing = gokartingGroups[type].items.find((i) => i.laps === variant.laps)
                if (!existing) {
                  gokartingGroups[type].items.push({
                    laps: variant.laps,
                    price: variant.price,
                    apiId: variant.id,
                  })
                }
              }
            }
          }
        } else {
          // Non-gokarting: each active variant becomes one Activity
          for (const subGame of game.subGames) {
            // Sub-game level visibility filtering
            const sgMeta = subGame.metadata as Record<string, unknown> | undefined
            const sgPlatforms =
              Array.isArray(sgMeta?.platforms) && (sgMeta!.platforms as string[]).length > 0
                ? (sgMeta!.platforms as (
                    | 'web'
                    | 'windows'
                    | 'android'
                    | 'ios'
                    | 'pos'
                    | 'bookings'
                  )[])
                : game.platforms
            if (!isPlatformAvailable(sgPlatforms)) continue
            const sgLocationKeys =
              Array.isArray(sgMeta?.locationKeys) && (sgMeta!.locationKeys as string[]).length > 0
                ? (sgMeta!.locationKeys as string[])
                : null
            if (sgLocationKeys && !sgLocationKeys.includes(locationId)) continue

            for (const variant of subGame.variants) {
              if (!variant.active) continue
              // Hide currently-unavailable variants (auto-expire honored).
              // When every variant of a non-gokarting game is flagged, no
              // Activity gets pushed and the game card disappears from the
              // browse list automatically.
              if (variantUnavailable(variant.metadata)) continue

              const variantName = variant.label || subGame.name
              if (isExcluded(variantName) || isExcluded(game.name)) continue
              if (variant.price <= 1) continue // skip test prices

              const activityId = `${game.id}-${subGame.id}-${variant.id}`
              otherActivities.push({
                id: activityId,
                apiId: variant.id,
                name: variantName,
                description:
                  (game.metadata?.shortDescription as string) || `${game.name} - ${subGame.name}`,
                longDescription: (game.metadata?.longDescription as string) || undefined,
                basePrice: variant.price,
                category: game.name,
                gameTypeId: game.id,
                image:
                  game.imageUrl ||
                  getImageUrl('', game.name) ||
                  'https://asquaregokarting.com/admin_secure/images/games/gokarting%201x1.jpg',
                icon: '',
                minAge: 8,
                duration: variant.durationMinutes || 15,
                maxParticipants: 10,
                peakMultiplier: 1.2,
                available: true,
                platforms: sgPlatforms,
              })
            }
          }
        }
      }

      // Process Gokarting groups
      Object.keys(gokartingGroups).forEach((key) => {
        const group = gokartingGroups[key]
        if (group.items.length > 0) {
          group.items.sort((a, b) => a.laps - b.laps)

          // Adult/Child: 8, 12, 15 Laps | Double: 8, 12 Laps
          const allowedLaps = key === 'double' ? [8, 12] : [8, 12, 15]
          const finalVariants = group.items.filter((v) => allowedLaps.includes(v.laps))

          if (finalVariants.length > 0) {
            resultActivities.push({
              id: `gokarting-${key}`,
              apiId: finalVariants[0].apiId,
              name: group.name,
              description: group.shortDescription || `Select your laps for ${group.name}`,
              longDescription: group.longDescription || undefined,
              basePrice: finalVariants[0].price,
              category: 'gokarting',
              gameTypeId: group.gameId,
              image:
                group.imageUrl ||
                getImageUrl('', 'gokarting') ||
                'https://asquaregokarting.com/admin_secure/images/games/gokarting%201x1.jpg',
              icon: 'ASQUARE_LOGO',
              minAge: key === 'child' ? 8 : key === 'double' ? 18 : 14,
              duration: 15,
              maxParticipants: 10,
              peakMultiplier: 1.1,
              available: true,
              platforms: group.platforms,
              variants: finalVariants,
            })
          }
        }
      })
    }

    // Merge Activities (main-app Firestore activities take precedence and appear first)
    const activityMap = new Map<string, Activity>()
    firestoreActivities.forEach((a) => activityMap.set(a.id, a))
    ;[...resultActivities, ...otherActivities].forEach((a) => {
      if (!activityMap.has(a.id)) {
        activityMap.set(a.id, a)
      }
    })

    const allActivities = Array.from(activityMap.values())

    // Custom sort order for activities
    const ACTIVITY_SORT_ORDER = [
      'gokarting',
      'helicopter',
      'paintball',
      'zipline',
      'rocket ejector',
      'cricket',
      'rifle shooting',
      'mechanical bull',
      'meltdown',
      'archery',
      'trampoline',
    ]

    // Sort activities based on custom order
    allActivities.sort((a, b) => {
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      const aCat = a.category?.toLowerCase() || ''
      const bCat = b.category?.toLowerCase() || ''

      // Find the index in sort order (check if name or category contains the keyword)
      const aIndex = ACTIVITY_SORT_ORDER.findIndex(
        (term) => aName.includes(term) || aCat.includes(term),
      )
      const bIndex = ACTIVITY_SORT_ORDER.findIndex(
        (term) => bName.includes(term) || bCat.includes(term),
      )

      // If both are in the sort order, compare by index
      if (aIndex !== -1 && bIndex !== -1) {
        if (aIndex === bIndex) {
          // Secondary sort for items in same category
          const category = ACTIVITY_SORT_ORDER[aIndex]
          if (category === 'paintball') {
            // Priority: 1. Bullets count, 2. VS, 3. Refill
            const aRefill = aName.includes('refill') || aName.includes('refelling')
            const bRefill = bName.includes('refill') || bName.includes('refelling')
            const aVS = aName.includes('vs') || aName.includes(' vs ')
            const bVS = bName.includes('vs') || bName.includes(' vs ')

            // 1. Bullets (no refill, no vs) -> Rank 0
            // 2. VS -> Rank 1
            // 3. Refill -> Rank 2
            const getPaintballRank = (isRefill: boolean, isVS: boolean) => {
              if (isRefill) return 2
              if (isVS) return 1
              return 0
            }

            const aRank = getPaintballRank(aRefill, aVS)
            const bRank = getPaintballRank(bRefill, bVS)

            if (aRank !== bRank) return aRank - bRank

            // Within same rank, sort by number if applicable (bullets)
            const aNum = parseInt(aName.match(/\d+/)?.[0] || '0')
            const bNum = parseInt(bName.match(/\d+/)?.[0] || '0')
            if (aNum !== bNum) return aNum - bNum
          }
          return 0
        }
        return aIndex - bIndex
      }
      // If only a is in the order, it comes first
      if (aIndex !== -1) return -1
      // If only b is in the order, it comes first
      if (bIndex !== -1) return 1
      // If neither is in the order, maintain original order
      return 0
    })

    // Filter by Date and Location (for main-app Firestore activities)
    const today = new Date().toISOString().split('T')[0]

    const finalResults = allActivities.filter((activity) => {
      // NEW: Schedule-based filtering (takes precedence)
      if (activity.schedule && activity.schedule.length > 0) {
        const matchingSchedule = activity.schedule.find(
          (s) =>
            (s.locationId === locationId || (locationId === '0' && s.locationId === '3')) &&
            s.startDate <= today &&
            s.endDate >= today,
        )
        return !!matchingSchedule
      }

      // LEGACY: Location Check (for activities without schedule)
      if (activity.locationIds && activity.locationIds.length > 0) {
        const hasMatch =
          activity.locationIds.includes(locationId) ||
          (locationId === '0' && activity.locationIds.includes('3'))
        if (!hasMatch) {
          return false
        }
      } else if (activity.branch) {
        // strict check against ID or Name if ID matches standard "1", "2", "3"
        // Assuming branch stores ID string like "1"
        if (activity.branch !== locationId) {
          // If branch name is stored (e.g. "Kakinada"), try matching that too
          // But based on user JSON, it stores ID "1"

          const isNameMatch =
            (locationId === '1' && activity.branch.toLowerCase() === 'kakinada') ||
            (locationId === '2' && activity.branch.toLowerCase() === 'rajahmundry') ||
            (locationId === '0' &&
              (activity.branch.toLowerCase() === 'visakhapatnam' ||
                activity.branch.toLowerCase() === 'vizag')) ||
            (locationId === '5' && activity.branch.toLowerCase() === 'srikakulam')

          if (!isNameMatch) return false
        }
      }

      // LEGACY: Date Check
      if (activity.startDate && activity.startDate > today) {
        return false
      }
      if (activity.endDate && activity.endDate < today) {
        return false
      }

      return true
    })

    // Filter by platform availability
    const platformFiltered = finalResults.filter((activity) =>
      isPlatformAvailable(activity.platforms),
    )

    // Save to cache
    activitiesCache.set(cacheKey, {
      data: platformFiltered,
      timestamp: Date.now(),
    })

    return platformFiltered
  } catch (error) {
    logger.error('activity.fetch_games_failed', error)
    return []
  }
}

// Fetch a single game by ID
export async function getGameById(
  locationId: string,
  activityId: string,
): Promise<Activity | null> {
  try {
    const games = await getGames(locationId)
    return games.find((g) => g.id === activityId) || null
  } catch (error) {
    logger.error('activity.fetch_game_by_id_failed', error)
    return null
  }
}

// Get available dates for helicopter rides at a specific location
export async function getHelicopterAvailableDates(locationId: string): Promise<string[]> {
  try {
    logger.info('activity.fetch_helicopter_dates', { locationId })

    // 1. Fetch all activities through the shared raw cache (deduped with
    //    getGames so a single page mount only hits Firestore once).
    const activities = await fetchAllActivitiesCached()

    // 2. Filter for Helicopter activities at this location
    const heliActivities = activities.filter((a) => {
      // Check if it's a helicopter activity
      const isHeli =
        a.name.toLowerCase().includes('helicopter') ||
        (a.category && a.category.toLowerCase().includes('helicopter'))

      if (!isHeli) return false

      // Check Location Availability
      // 1. Check schedule (highest priority location check)
      if (a.schedule && a.schedule.length > 0) {
        // Check if ANY schedule entry matches this location
        return a.schedule.some(
          (s) => s.locationId === locationId || (locationId === '0' && s.locationId === '3'),
        )
      }

      // 2. Check locationIds array
      if (a.locationIds && a.locationIds.length > 0) {
        return (
          a.locationIds.includes(locationId) || (locationId === '0' && a.locationIds.includes('3'))
        )
      }

      // 3. Check branch ID
      if (a.branch === locationId) return true

      // 4. Fallback: If no location constraints are set, assume global?
      // Better to be strict: if no location info, exclude unless it's explicitly global
      return false
    })

    logger.info('activity.helicopter_activities_found', {
      count: heliActivities.length,
      locationId,
    })

    // 3. Extract Dates
    const dates = new Set<string>()
    const today = new Date().toISOString().split('T')[0]

    heliActivities.forEach((a) => {
      // Priority 1: availableDates array (Specific dates)
      if (a.availableDates && Array.isArray(a.availableDates)) {
        a.availableDates.forEach((d) => {
          if (d >= today) dates.add(d)
        })
      }

      // Priority 2: Schedule (Date Ranges)
      if (a.schedule && Array.isArray(a.schedule)) {
        a.schedule.forEach((s) => {
          // Only use schedule entries for THIS location
          if (s.locationId === locationId || (locationId === '0' && s.locationId === '3')) {
            const start = s.startDate
            const end = s.endDate

            // Iterate and add dates
            const current = new Date(start < today ? today : start)
            const endDate = new Date(end)

            while (current <= endDate) {
              dates.add(current.toISOString().split('T')[0])
              current.setDate(current.getDate() + 1)
            }
          }
        })
      }

      // Priority 3: Legacy Start/End Date (If no schedule/availableDates)
      // Only apply if this legacy date range applies to the location (checked above)
      if (!a.schedule && !a.availableDates && a.startDate && a.endDate) {
        const start = a.startDate
        const end = a.endDate

        const current = new Date(start < today ? today : start)
        const endDate = new Date(end)

        while (current <= endDate) {
          dates.add(current.toISOString().split('T')[0])
          current.setDate(current.getDate() + 1)
        }
      }
    })

    return Array.from(dates).sort()
  } catch (error) {
    logger.error('activity.fetch_helicopter_dates_failed', error)
    return []
  }
}

/**
 * List all legacy `activities/{id}` docs along with their soft-availability
 * state. Used by the owner/admin Availability modal to surface helicopter +
 * specials alongside the variant-hierarchy items so they can be flagged
 * unavailable through the same UI.
 *
 * Cached for 60s with request coalescing. Repeated calls within the same
 * session (e.g. defensive availability re-checks at submit time) collapse
 * onto one Firestore round-trip. `clearLegacyActivitiesCache()` is called
 * from `setLegacyActivityAvailability` after a successful write so the next
 * read sees fresh state.
 */
const LEGACY_TTL_MS = 60_000
let _legacyCache: { data: Activity[]; expiresAt: number } | null = null
let _legacyInflight: Promise<Activity[]> | null = null

export function clearLegacyActivitiesCache(): void {
  _legacyCache = null
  _legacyInflight = null
}

export async function listLegacyActivities(): Promise<Activity[]> {
  if (_legacyCache && Date.now() < _legacyCache.expiresAt) {
    return _legacyCache.data
  }
  if (_legacyInflight) return _legacyInflight
  _legacyInflight = (async () => {
    try {
      const snap = await getDocs(collection(db, 'activities'))
      return snap.docs.map((d) => {
        const data = d.data()
        return { ...data, id: data.id || d.id } as Activity
      })
    } catch (error) {
      logger.error('activity.list_legacy_failed', error)
      return []
    }
  })()
    .then((data) => {
      _legacyCache = { data, expiresAt: Date.now() + LEGACY_TTL_MS }
      return data
    })
    .finally(() => {
      _legacyInflight = null
    })
  return _legacyInflight
}

/**
 * Toggle the soft-availability flag on a legacy `activities/{id}` doc. Mirrors
 * the variant-level setActivityAvailability. Restoring writes `null` to all
 * flag fields so Firestore merge cleans them out (no zombie `false` flags).
 *
 * Loud-fails to logger; never throws so booking surfaces stay alive even if
 * the write fails.
 */
export async function setLegacyActivityAvailability(
  activityId: string,
  params: {
    unavailable: boolean
    reason?: string
    markedById?: string
    markedByName?: string
    /** ISO datetime — flag auto-restores after this point. Omit for open-ended. */
    until?: string
  },
): Promise<boolean> {
  try {
    if (!activityId) return false
    const ref = doc(db, 'activities', activityId)
    const patch: Record<string, unknown> = params.unavailable
      ? {
          temporarilyUnavailable: true,
          temporarilyUnavailableReason: params.reason ?? '',
          temporarilyUnavailableSince: new Date().toISOString(),
          temporarilyUnavailableMarkedById: params.markedById ?? '',
          temporarilyUnavailableMarkedByName: params.markedByName ?? '',
          temporarilyUnavailableUntil: params.until ?? null,
        }
      : {
          temporarilyUnavailable: null,
          temporarilyUnavailableReason: null,
          temporarilyUnavailableSince: null,
          temporarilyUnavailableMarkedById: null,
          temporarilyUnavailableMarkedByName: null,
          temporarilyUnavailableUntil: null,
        }
    await setDoc(ref, patch, { merge: true })
    // Invalidate the legacy cache so the next read returns the new state.
    clearLegacyActivitiesCache()
    return true
  } catch (error) {
    logger.error('activity.set_legacy_availability_failed', error, { activityId })
    return false
  }
}
