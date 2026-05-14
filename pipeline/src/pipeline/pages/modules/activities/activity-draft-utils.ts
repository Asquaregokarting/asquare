import type { ActivityLocationTreeRecord } from '../../../api/types'
import { ALL_PLATFORMS as ALL_PLATFORMS_LIB } from '../../../../lib/platform'
import type { AppPlatform } from '../../../../lib/platform'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type VariantMetric =
  | 'duration'
  | 'laps'
  | 'bullets'
  | 'arrows'
  | 'rounds'
  | 'balls'
  | 'shots'
export type SubGameDialogMode = 'variants' | 'edit_subgame' | 'edit_variant'
export type GameType = 'our_game' | 'vendor_game' | 'sub_lease'
export type ActivitiesView = 'list' | 'combos' | 'bulk-import'

export interface VariantDraft {
  key: string
  label: string
  price: string
  metricType: VariantMetric
  metricValue: string
  active: boolean
  notes: string
  visibleInPOS: boolean
  visibleInProtocol: boolean
  visibleInOffers: boolean
  visibleInBooking: boolean
  offerPrice: string
  printIndividualTokens: boolean
}

export interface SubGameDraft {
  key: string
  name: string
  notes: string
  platforms: AppPlatform[]
  locationKeys: string[]
  /**
   * Approved Interakt template name to use for booking-confirmation
   * WhatsApp messages on this sub-game (e.g. "booking_confirm_pdf_util"
   * for helicopter, "booking_confirmed_ticket" for go-karting). Empty =
   * inherit from BookingConfirmationConfig default.
   */
  interaktTemplateId: string
  /** Language code for the template; empty = inherit from config default. */
  interaktTemplateLanguage: string
  variants: VariantDraft[]
}

export interface GameDraft {
  key: string
  name: string
  status: 'Active' | 'Inactive'
  platforms: AppPlatform[]
  imageUrls: string[]
  imageFiles: File[]
  imagePreviews: string[]
  shortDescription: string
  longDescription: string
  gameType: GameType
  vendorUserId: string
  vendorName: string
  vendorBranchId: string
  subGames: SubGameDraft[]
}

export interface ConfirmDialogState {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const ALL_PLATFORMS: AppPlatform[] = [...ALL_PLATFORMS_LIB]

export const METRIC_LABELS: Record<VariantMetric, string> = {
  duration: 'min',
  laps: 'laps',
  bullets: 'bullets',
  arrows: 'arrows',
  rounds: 'rounds',
  balls: 'balls',
  shots: 'shots',
}

// ---------------------------------------------------------------------------
// Draft factories
// ---------------------------------------------------------------------------
export const createDraftKey = (): string =>
  `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const createVariantDraft = (): VariantDraft => ({
  key: createDraftKey(),
  label: '',
  price: '',
  metricType: 'duration',
  metricValue: '',
  active: true,
  notes: '',
  visibleInPOS: true,
  visibleInProtocol: false,
  visibleInOffers: false,
  visibleInBooking: true,
  offerPrice: '',
  printIndividualTokens: false,
})

export const createSubGameDraft = (): SubGameDraft => ({
  key: createDraftKey(),
  name: '',
  notes: '',
  platforms: [],
  locationKeys: [],
  interaktTemplateId: '',
  interaktTemplateLanguage: '',
  variants: [createVariantDraft()],
})

export const createGameDraft = (): GameDraft => ({
  key: createDraftKey(),
  name: '',
  status: 'Active',
  platforms: [...ALL_PLATFORMS],
  imageUrls: [],
  imageFiles: [],
  imagePreviews: [],
  shortDescription: '',
  longDescription: '',
  gameType: 'our_game',
  vendorUserId: '',
  vendorName: '',
  vendorBranchId: '',
  subGames: [createSubGameDraft()],
})

// ---------------------------------------------------------------------------
// Conversion: API tree → Draft
// ---------------------------------------------------------------------------
export const toDrafts = (location?: ActivityLocationTreeRecord): GameDraft[] =>
  (location?.games ?? []).map((game) => {
    const existingUrls: string[] = Array.isArray(
      (game.metadata as Record<string, unknown> | undefined)?.imageUrls,
    )
      ? ((game.metadata as Record<string, unknown>).imageUrls as string[]).filter(Boolean)
      : game.imageUrl
        ? [game.imageUrl]
        : []
    return {
      key: game.id,
      name: game.name,
      status: game.status,
      // Distinguish "field absent" (legacy doc → default to all platforms)
      // from "explicitly empty" (user unchecked everything → keep it empty
      // so the editor shows the same state they saved). The previous check
      // collapsed both cases to ALL_PLATFORMS, so unticking everything
      // silently re-checked everything on reload.
      platforms: Array.isArray(game.platforms) ? [...game.platforms] : [...ALL_PLATFORMS],
      imageUrls: existingUrls,
      imageFiles: [],
      imagePreviews: [...existingUrls],
      shortDescription: String(game.metadata?.shortDescription ?? ''),
      longDescription: String(game.metadata?.longDescription ?? ''),
      gameType: (game.metadata?.gameType as GameType) ?? 'our_game',
      vendorUserId: String(game.metadata?.vendorUserId ?? ''),
      vendorName: String(game.metadata?.vendorName ?? ''),
      vendorBranchId: String(game.metadata?.vendorBranchId ?? ''),
      subGames: game.subGames.map((subGame) => ({
        key: subGame.id,
        name: subGame.name,
        notes: String(subGame.metadata?.notes ?? ''),
        platforms: Array.isArray(subGame.metadata?.platforms)
          ? [...(subGame.metadata!.platforms as AppPlatform[])]
          : [],
        locationKeys: Array.isArray(subGame.metadata?.locationKeys)
          ? [...(subGame.metadata!.locationKeys as string[])]
          : [],
        interaktTemplateId: String(subGame.interaktTemplateId ?? ''),
        interaktTemplateLanguage: String(subGame.interaktTemplateLanguage ?? ''),
        variants: subGame.variants.map((variant) => ({
          key: variant.id,
          label: variant.label,
          price: String(variant.price),
          metricType: ((): VariantMetric => {
            const meta = variant.metadata as Record<string, unknown> | undefined
            if (meta?.metricType && typeof meta.metricType === 'string')
              return meta.metricType as VariantMetric
            if (typeof variant.laps === 'number' && variant.laps > 0) return 'laps'
            return 'duration'
          })(),
          metricValue: String(
            ((variant.metadata as Record<string, unknown> | undefined)?.metricValue as
              | number
              | undefined) ??
              variant.laps ??
              variant.durationMinutes ??
              '',
          ),
          active: variant.active,
          notes: String(variant.metadata?.notes ?? ''),
          visibleInPOS: (() => {
            const meta = variant.metadata as Record<string, unknown> | undefined
            if (typeof meta?.visibleInPOS === 'boolean') return meta.visibleInPOS
            // Backward compat: old offer/protocol-only variants were not meant for normal POS
            const subName = (subGame.name ?? '').toLowerCase()
            const isOldOffer = subName.includes('offer')
            const isOldProtocol = typeof variant.laps === 'number' && variant.laps === 5
            if (isOldOffer || isOldProtocol) return false
            return true
          })(),
          visibleInProtocol: (() => {
            const meta = variant.metadata as Record<string, unknown> | undefined
            if (typeof meta?.visibleInProtocol === 'boolean') return meta.visibleInProtocol
            return typeof variant.laps === 'number' && variant.laps === 5
          })(),
          visibleInOffers: (() => {
            const meta = variant.metadata as Record<string, unknown> | undefined
            if (typeof meta?.visibleInOffers === 'boolean') return meta.visibleInOffers
            return (subGame.name ?? '').toLowerCase().includes('offer')
          })(),
          visibleInBooking: (() => {
            const meta = variant.metadata as Record<string, unknown> | undefined
            if (typeof meta?.visibleInBooking === 'boolean') return meta.visibleInBooking
            return true // backward compat: existing variants default to visible in booking
          })(),
          offerPrice: String(
            (variant.metadata as Record<string, unknown> | undefined)?.offerPrice ?? '',
          ),
          printIndividualTokens: (() => {
            const meta = variant.metadata as Record<string, unknown> | undefined
            return typeof meta?.printIndividualTokens === 'boolean'
              ? meta.printIndividualTokens
              : false
          })(),
        })),
      })),
    }
  })

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
export const countNonEmptyLines = (text: string): number =>
  text.split('\n').filter((l) => l.trim()).length

export const formatMetric = (variant: {
  metricType: VariantMetric
  metricValue: string
}): string => {
  const value = String(variant.metricValue ?? '').trim()
  if (!value) return 'Metric pending'
  return `${value} ${METRIC_LABELS[variant.metricType] ?? variant.metricType}`
}

export const formatSavedMetric = (variant: {
  durationMinutes?: number
  laps?: number
  metadata?: Record<string, unknown>
}): string => {
  const meta = variant.metadata as Record<string, unknown> | undefined
  if (
    meta?.metricType &&
    typeof meta.metricType === 'string' &&
    meta.metricType !== 'duration' &&
    meta.metricType !== 'laps'
  ) {
    const value = Number(meta.metricValue ?? 0)
    return `${value} ${METRIC_LABELS[meta.metricType as VariantMetric] ?? meta.metricType}`
  }
  if (typeof variant.laps === 'number' && variant.laps > 0) {
    return `${variant.laps} laps`
  }
  if (typeof variant.durationMinutes === 'number' && variant.durationMinutes > 0) {
    return `${variant.durationMinutes} min`
  }
  return 'Metric pending'
}

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })

// ---------------------------------------------------------------------------
// Location name helper
// ---------------------------------------------------------------------------
export const getLocationName = (
  locationId: string,
  hierarchy?: ActivityLocationTreeRecord[],
  fallbackFn?: (id: string) => string,
): string =>
  hierarchy?.find((entry) => entry.id === locationId)?.name ??
  fallbackFn?.(locationId) ??
  locationId

// ---------------------------------------------------------------------------
// Saveable check (auto-save gate — relaxed validation)
// ---------------------------------------------------------------------------
export const isSaveable = (games: GameDraft[]): boolean => {
  if (games.length === 0) return false

  for (const game of games) {
    if (!game.name.trim()) return false
    if (game.subGames.length === 0) return false

    const subGameNames = new Set<string>()
    for (const subGame of game.subGames) {
      if (!subGame.name.trim()) return false
      const normalised = subGame.name.trim().toLowerCase()
      if (subGameNames.has(normalised)) return false
      subGameNames.add(normalised)

      if (subGame.variants.length === 0) return false
      const variantLabels = new Set<string>()
      for (const variant of subGame.variants) {
        if (!variant.label.trim()) return false
        const normLabel = variant.label.trim().toLowerCase()
        if (variantLabels.has(normLabel)) return false
        variantLabels.add(normLabel)
      }
    }
  }

  // Check game name uniqueness on the user-visible label, not the
  // derived document id — derivation collapses too many distinct names
  // ("5 laps" / "laps 5" → same id), and the writer uses opaque ids now.
  const gameNames = games.map((g) => g.name.trim().toLowerCase())
  if (gameNames.some((n) => !n)) return false
  if (new Set(gameNames).size !== gameNames.length) return false

  return true
}

// ---------------------------------------------------------------------------
// Warning-level validation (shown in UI, doesn't block save)
// ---------------------------------------------------------------------------
export interface ValidationWarning {
  path: string // e.g. "Go Karting > Standard > 5 Laps"
  message: string
}

export const validateWarnings = (games: GameDraft[]): ValidationWarning[] => {
  const warnings: ValidationWarning[] = []

  for (const game of games) {
    if (!game.name.trim()) continue
    const gn = game.name.trim()

    if (game.longDescription.trim().length === 0) {
      warnings.push({ path: gn, message: 'Missing long description' })
    } else if (countNonEmptyLines(game.longDescription) < 3) {
      warnings.push({ path: gn, message: 'Description should be at least 3 lines' })
    }

    if (game.platforms.length === 0) {
      warnings.push({ path: gn, message: 'No platforms selected — game will be hidden' })
    }

    for (const subGame of game.subGames) {
      if (!subGame.name.trim()) continue
      const sgn = `${gn} > ${subGame.name.trim()}`

      if (subGame.platforms.length > 0) {
        const extra = subGame.platforms.filter((p) => !game.platforms.includes(p))
        if (extra.length > 0) {
          warnings.push({
            path: sgn,
            message: `Sub-game has platforms [${extra.join(', ')}] not enabled on parent game`,
          })
        }
      }

      for (const variant of subGame.variants) {
        if (!variant.label.trim()) continue
        const vn = `${sgn} > ${variant.label.trim()}`
        const price = Number(variant.price)
        const metric = Number(variant.metricValue)
        if (!Number.isFinite(price) || price <= 0) {
          warnings.push({ path: vn, message: 'Price is 0 or empty' })
        }
        if (!Number.isFinite(metric) || metric <= 0) {
          warnings.push({
            path: vn,
            message: `${METRIC_LABELS[variant.metricType] ?? 'Metric'} value is 0 or empty`,
          })
        }
        if (variant.visibleInOffers) {
          const op = Number(variant.offerPrice)
          if (!Number.isFinite(op) || op <= 0) {
            warnings.push({ path: vn, message: 'Offer Price is 0 or empty but Offers is checked' })
          }
        }
        if (
          !variant.visibleInPOS &&
          !variant.visibleInProtocol &&
          !variant.visibleInOffers &&
          !variant.visibleInBooking
        ) {
          warnings.push({ path: vn, message: 'Variant is not visible in any mode' })
        }
      }
    }
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Full validation (used for strict checks — e.g. manual save button fallback)
// ---------------------------------------------------------------------------
export const validateDrafts = (games: GameDraft[]): void => {
  if (games.length === 0) {
    throw new Error('Add at least one game before saving.')
  }
  // Uniqueness checks compare trimmed, case-insensitive labels — the
  // writer uses opaque doc ids (see `replaceFirestoreLocationHierarchy`),
  // so the old practice of deriving an id from the label and comparing
  // those derived ids would falsely reject distinct-but-similar labels
  // ("5 laps" vs "laps 5" → same derivation).
  const norm = (s: string): string => s.trim().toLowerCase()
  const gameNames = games.map((game) => norm(game.name))
  if (gameNames.some((n) => !n)) {
    throw new Error('Every game needs a name before saving.')
  }
  if (new Set(gameNames).size !== gameNames.length) {
    throw new Error('Game names must be unique within a location.')
  }
  games.forEach((game) => {
    if (game.longDescription.trim().length === 0) {
      throw new Error(
        `Add a description for "${game.name || 'each game'}". At least 3-4 lines recommended.`,
      )
    }
    const descLines = countNonEmptyLines(game.longDescription)
    if (descLines < 3) {
      throw new Error(`Description for "${game.name}" is too short. Please write at least 3 lines.`)
    }
    if (!game.subGames.length) {
      throw new Error(`Add at least one sub game for ${game.name || 'each game'}.`)
    }
    const subGameNames = game.subGames.map((sg) => norm(sg.name))
    if (subGameNames.some((n) => !n)) {
      throw new Error(`Each sub game inside ${game.name || 'a game'} needs a name.`)
    }
    if (new Set(subGameNames).size !== subGameNames.length) {
      throw new Error(`Sub game names must be unique inside ${game.name || 'a game'}.`)
    }
    game.subGames.forEach((subGame) => {
      if (!subGame.variants.length) {
        throw new Error(`Add at least one variant for ${subGame.name || 'each sub game'}.`)
      }
      const variantLabels = subGame.variants.map((v) => norm(v.label))
      if (variantLabels.some((l) => !l)) {
        throw new Error(`Each variant inside ${subGame.name || 'a sub game'} needs a label.`)
      }
      if (new Set(variantLabels).size !== variantLabels.length) {
        throw new Error(`Variant labels must be unique inside ${subGame.name || 'a sub game'}.`)
      }
      subGame.variants.forEach((variant) => {
        const numericMetric = Number(variant.metricValue)
        const numericPrice = Number(variant.price)
        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
          throw new Error(`Enter a valid price for ${variant.label || 'each variant'}.`)
        }
        if (!Number.isFinite(numericMetric) || numericMetric <= 0) {
          throw new Error(
            `Enter a valid ${METRIC_LABELS[variant.metricType] ?? 'metric'} value for ${variant.label || 'each variant'}.`,
          )
        }
      })
    })
  })
}
