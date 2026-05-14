import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activitiesApi, ActivitiesHierarchyResponse } from '../../../api/activities'
import { createGameDocumentId } from '../../../api/activities-firestore'
import type {
  ActivityLocationTreeRecord,
  BranchLocationKey,
  VendorDetailsRecord,
} from '../../../api/types'
import { asquareLocationsApi } from '../../../api/asquare-locations'
import { vendorDetailsApi } from '../../../api/vendor-details'
import { useAuth } from '../../../features/auth/auth-context'
import { uploadPipelineFile } from '../../../lib/firebase-storage'
import { useLocations } from '../../../hooks/useLocations'
import { branchIdToDisplayName } from '../../../../lib/locations'
import type { SummaryCardItem } from '../../../components/ui/SummaryCards'
import {
  type GameDraft,
  type SubGameDraft,
  type VariantDraft,
  type ConfirmDialogState,
  createDraftKey,
  createGameDraft,
  createSubGameDraft,
  createVariantDraft,
  toDrafts,
  getLocationName,
  readFileAsDataUrl,
  isSaveable,
} from './activity-draft-utils'

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------
export interface ActivitiesEditorState {
  // Data
  hierarchy: ActivityLocationTreeRecord[]
  draftsByLocation: Record<string, GameDraft[]>
  currentDrafts: GameDraft[]
  currentLocationName: string
  availableLocations: { id: BranchLocationKey; name: string }[]
  approvedVendors: VendorDetailsRecord[]
  summaryItems: SummaryCardItem[]
  locationOptions: { id: BranchLocationKey; name: string }[]

  // Navigation
  activeLocation: BranchLocationKey
  setActiveLocation: (loc: BranchLocationKey) => void
  selectedGameKey: string | null
  setSelectedGameKey: (key: string | null) => void
  selectedGame: GameDraft | null
  selectedSubGameKey: string | null
  setSelectedSubGameKey: (key: string | null) => void
  selectedSubGame: SubGameDraft | null

  // Mutations
  addGame: (
    prefill?: Partial<
      Pick<
        GameDraft,
        | 'name'
        | 'imageFiles'
        | 'imagePreviews'
        | 'imageUrls'
        | 'gameType'
        | 'vendorUserId'
        | 'vendorName'
        | 'vendorBranchId'
      >
    >,
  ) => void
  updateGame: (gameKey: string, updater: (game: GameDraft) => GameDraft) => void
  removeGame: (gameKey: string) => void
  addSubGame: (gameKey: string, name?: string) => void
  updateSubGame: (
    gameKey: string,
    subGameKey: string,
    updater: (sg: SubGameDraft) => SubGameDraft,
  ) => void
  removeSubGame: (gameKey: string, subGameKey: string) => void
  addVariant: (gameKey: string, subGameKey: string) => void
  updateVariant: (
    gameKey: string,
    subGameKey: string,
    variantKey: string,
    updater: (v: VariantDraft) => VariantDraft,
  ) => void
  removeVariant: (gameKey: string, subGameKey: string, variantKey: string) => void
  toggleGameInLocation: (locationId: string) => void
  handleImageChange: (gameKey: string, event: ChangeEvent<HTMLInputElement>) => Promise<void>
  removeGameImage: (gameKey: string, index: number) => void

  // Location management
  handleAddLocation: (name: string, shortName?: string) => Promise<void>

  // Save support
  buildSavePayload: (drafts: GameDraft[]) => Promise<{
    locationKey: BranchLocationKey
    locationName: string
    games: Array<{
      name: string
      imageUrl?: string
      status: 'Active' | 'Inactive'
      platforms?: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[]
      metadata?: Record<string, unknown>
      subGames: Array<{
        name: string
        metadata?: Record<string, unknown>
        variants: Array<{
          label: string
          price: number
          durationMinutes?: number
          laps?: number
          active: boolean
          metadata?: Record<string, unknown>
        }>
      }>
    }>
  }>
  performSave: (drafts: GameDraft[]) => Promise<void>

  // Load/Reset
  loading: boolean
  saving: boolean
  error: string | null
  setError: (err: string | null) => void
  success: string | null
  setSuccess: (msg: string | null) => void
  loadHierarchy: () => Promise<void>
  resetLocation: () => void

  // Confirm dialog
  confirmDialog: ConfirmDialogState | null
  setConfirmDialog: (state: ConfirmDialogState | null) => void

  // Auth
  token: string | undefined
  canManageActivities: boolean
  isThirdParty: boolean
  role: string | undefined
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export const useActivitiesEditor = (): ActivitiesEditorState => {
  const { session } = useAuth()
  const { enabledLocations, refetch: refetchLocations, locations: allLocations } = useLocations()
  const locationOptions = useMemo(
    () =>
      enabledLocations.map((l) => ({ id: l.branchId as BranchLocationKey, name: l.displayName })),
    [enabledLocations],
  )
  const token = session?.token
  const role = session?.user.role
  const canManageActivities = role === 'Owner' || role === 'Admin'
  const isThirdParty = role === 'ThirdParty'

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [hierarchy, setHierarchy] = useState<ActivityLocationTreeRecord[]>([])
  const [activeLocation, setActiveLocation] = useState<BranchLocationKey>('0')
  const [draftsByLocation, setDraftsByLocation] = useState<Record<string, GameDraft[]>>({})
  const [selectedGameKey, setSelectedGameKey] = useState<string | null>(null)
  const [selectedSubGameKey, setSelectedSubGameKey] = useState<string | null>(null)
  const [approvedVendors, setApprovedVendors] = useState<VendorDetailsRecord[]>([])
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)

  // -----------------------------------------------------------------------
  // Load
  // -----------------------------------------------------------------------
  // Use ref to avoid re-creating loadHierarchy when locationOptions changes
  const locationOptionsRef = useRef(locationOptions)
  locationOptionsRef.current = locationOptions

  const loadHierarchy = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result: ActivitiesHierarchyResponse = await activitiesApi.listHierarchy(token)
      setHierarchy(result.locations)
      setDraftsByLocation(() => {
        const next: Record<string, GameDraft[]> = {}
        const keys = new Set<string>([
          ...locationOptionsRef.current.map((e) => e.id),
          ...result.locations.map((e) => e.id),
        ])
        keys.forEach((id) => {
          next[id] = toDrafts(result.locations.find((e) => e.id === id))
        })
        return next
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load activities.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadHierarchy()
  }, [loadHierarchy])

  useEffect(() => {
    if (!token || !canManageActivities) return
    void vendorDetailsApi
      .list(token)
      .then(setApprovedVendors)
      .catch(() => {})
  }, [token, canManageActivities])

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------
  const availableLocations = useMemo(() => {
    const base = new Map<string, { id: BranchLocationKey; name: string }>()
    locationOptions.forEach((e) => base.set(e.id, e))
    hierarchy.forEach((e) => base.set(e.id, { id: e.id, name: e.name }))
    return [...base.values()].sort((a, b) => a.id.localeCompare(b.id))
  }, [hierarchy, locationOptions])

  useEffect(() => {
    if (!availableLocations.some((e) => e.id === activeLocation) && availableLocations[0]) {
      setActiveLocation(availableLocations[0].id)
    }
  }, [activeLocation, availableLocations])

  const EMPTY_DRAFTS: GameDraft[] = useMemo(() => [], [])
  const allCurrentDrafts = draftsByLocation[activeLocation] ?? EMPTY_DRAFTS
  const currentDrafts = useMemo(
    () =>
      isThirdParty
        ? allCurrentDrafts.filter(
            (g) =>
              (g.gameType === 'vendor_game' || g.gameType === 'sub_lease') &&
              g.vendorUserId === session?.user.id,
          )
        : allCurrentDrafts,
    [allCurrentDrafts, isThirdParty, session?.user.id],
  )

  const currentLocationName = getLocationName(activeLocation, hierarchy, branchIdToDisplayName)
  const selectedGame = currentDrafts.find((g) => g.key === selectedGameKey) ?? null
  const selectedSubGame = selectedGame?.subGames.find((sg) => sg.key === selectedSubGameKey) ?? null

  // Auto-select first game when drafts change
  useEffect(() => {
    if (currentDrafts.length === 0) {
      setSelectedGameKey(null)
      return
    }
    if (!selectedGameKey || !currentDrafts.some((g) => g.key === selectedGameKey)) {
      setSelectedGameKey(currentDrafts[0].key)
    }
  }, [currentDrafts, selectedGameKey])

  // Clear sub-game selection when game changes
  useEffect(() => {
    if (!selectedGame) {
      setSelectedSubGameKey(null)
    } else if (
      selectedSubGameKey &&
      !selectedGame.subGames.some((sg) => sg.key === selectedSubGameKey)
    ) {
      setSelectedSubGameKey(null)
    }
  }, [selectedGame, selectedSubGameKey])

  const counts = useMemo(
    () => ({
      games: currentDrafts.length,
      subGames: currentDrafts.reduce((s, g) => s + g.subGames.length, 0),
      variants: currentDrafts.reduce(
        (s, g) => s + g.subGames.reduce((sv, sg) => sv + sg.variants.length, 0),
        0,
      ),
    }),
    [currentDrafts],
  )

  const summaryItems = useMemo<SummaryCardItem[]>(
    () => [
      { id: 'location', label: 'Active Location', value: currentLocationName, tone: 'info' },
      { id: 'games', label: 'Games', value: String(counts.games), tone: 'info' },
      { id: 'subgames', label: 'Sub Games', value: String(counts.subGames), tone: 'muted' },
      { id: 'variants', label: 'Variants', value: String(counts.variants), tone: 'success' },
    ],
    [counts, currentLocationName],
  )

  // -----------------------------------------------------------------------
  // Draft mutations
  // -----------------------------------------------------------------------
  const updateLocationDrafts = useCallback(
    (updater: (current: GameDraft[]) => GameDraft[]) => {
      setDraftsByLocation((curr) => ({
        ...curr,
        [activeLocation]: updater(curr[activeLocation] ?? []),
      }))
    },
    [activeLocation],
  )

  const addGame = useCallback(
    (
      prefill?: Partial<
        Pick<
          GameDraft,
          | 'name'
          | 'imageFiles'
          | 'imagePreviews'
          | 'imageUrls'
          | 'gameType'
          | 'vendorUserId'
          | 'vendorName'
          | 'vendorBranchId'
        >
      >,
    ) => {
      const nextGame: GameDraft = { ...createGameDraft(), ...prefill }
      updateLocationDrafts((curr) => [...curr, nextGame])
      setSelectedGameKey(nextGame.key)
    },
    [updateLocationDrafts],
  )

  const updateGame = useCallback(
    (gameKey: string, updater: (game: GameDraft) => GameDraft) =>
      updateLocationDrafts((curr) => curr.map((g) => (g.key === gameKey ? updater(g) : g))),
    [updateLocationDrafts],
  )

  const removeGame = useCallback(
    (gameKey: string) => updateLocationDrafts((curr) => curr.filter((g) => g.key !== gameKey)),
    [updateLocationDrafts],
  )

  const addSubGame = useCallback(
    (gameKey: string, name = '') =>
      updateGame(gameKey, (g) => ({
        ...g,
        subGames: [...g.subGames, { ...createSubGameDraft(), name }],
      })),
    [updateGame],
  )

  const updateSubGame = useCallback(
    (gameKey: string, subGameKey: string, updater: (sg: SubGameDraft) => SubGameDraft) =>
      updateGame(gameKey, (g) => ({
        ...g,
        subGames: g.subGames.map((sg) => (sg.key === subGameKey ? updater(sg) : sg)),
      })),
    [updateGame],
  )

  const removeSubGame = useCallback(
    (gameKey: string, subGameKey: string) =>
      updateGame(gameKey, (g) => ({
        ...g,
        subGames: g.subGames.filter((sg) => sg.key !== subGameKey),
      })),
    [updateGame],
  )

  const addVariant = useCallback(
    (gameKey: string, subGameKey: string) =>
      updateSubGame(gameKey, subGameKey, (sg) => ({
        ...sg,
        variants: [...sg.variants, createVariantDraft()],
      })),
    [updateSubGame],
  )

  const updateVariant = useCallback(
    (
      gameKey: string,
      subGameKey: string,
      variantKey: string,
      updater: (v: VariantDraft) => VariantDraft,
    ) =>
      updateSubGame(gameKey, subGameKey, (sg) => ({
        ...sg,
        variants: sg.variants.map((v) => (v.key === variantKey ? updater(v) : v)),
      })),
    [updateSubGame],
  )

  const removeVariant = useCallback(
    (gameKey: string, subGameKey: string, variantKey: string) =>
      updateSubGame(gameKey, subGameKey, (sg) => ({
        ...sg,
        variants: sg.variants.filter((v) => v.key !== variantKey),
      })),
    [updateSubGame],
  )

  const toggleGameInLocation = useCallback(
    (locationId: string) => {
      if (!selectedGame) return
      setDraftsByLocation((current) => {
        const next = { ...current }
        const locationDrafts = [...(next[locationId] ?? [])]
        const gameName = selectedGame.name.trim().toLowerCase()
        const existingIdx = locationDrafts.findIndex(
          (g) => g.name.trim().toLowerCase() === gameName,
        )
        if (existingIdx >= 0) {
          locationDrafts.splice(existingIdx, 1)
        } else {
          const deepCopy = (game: GameDraft): GameDraft => ({
            ...game,
            key: createDraftKey(),
            subGames: game.subGames.map((sg) => ({
              ...sg,
              key: createDraftKey(),
              platforms: [...sg.platforms],
              locationKeys: [...sg.locationKeys],
              variants: sg.variants.map((v) => ({ ...v, key: createDraftKey() })),
            })),
          })
          locationDrafts.push(deepCopy(selectedGame))
        }
        next[locationId] = locationDrafts
        return next
      })
    },
    [selectedGame],
  )

  // -----------------------------------------------------------------------
  // Image handling
  // -----------------------------------------------------------------------
  const handleImageChange = useCallback(
    async (gameKey: string, event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return
      try {
        const newFiles: File[] = []
        const newPreviews: string[] = []
        for (let i = 0; i < files.length; i++) {
          newFiles.push(files[i])
          newPreviews.push(await readFileAsDataUrl(files[i]))
        }
        updateGame(gameKey, (g) => ({
          ...g,
          imageFiles: [...g.imageFiles, ...newFiles],
          imagePreviews: [...g.imagePreviews, ...newPreviews],
        }))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Failed to read image.')
      } finally {
        event.target.value = ''
      }
    },
    [updateGame],
  )

  const removeGameImage = useCallback(
    (gameKey: string, index: number) => {
      updateGame(gameKey, (game) => {
        const nextPreviews = game.imagePreviews.filter((_, i) => i !== index)
        const existingCount = game.imageUrls.length
        if (index < existingCount) {
          return {
            ...game,
            imageUrls: game.imageUrls.filter((_, i) => i !== index),
            imagePreviews: nextPreviews,
          }
        }
        const fileIndex = index - existingCount
        return {
          ...game,
          imageFiles: game.imageFiles.filter((_, i) => i !== fileIndex),
          imagePreviews: nextPreviews,
        }
      })
    },
    [updateGame],
  )

  // -----------------------------------------------------------------------
  // Location management
  // -----------------------------------------------------------------------
  const handleAddLocation = useCallback(
    async (name: string, shortName?: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      setSaving(true)
      setError(null)
      try {
        const newLoc = await asquareLocationsApi.createLocation(
          trimmed,
          shortName?.trim() || undefined,
          allLocations,
        )
        setHierarchy((curr) => [
          ...curr,
          {
            id: newLoc.branchId as BranchLocationKey,
            name: newLoc.displayName,
            games: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ])
        setDraftsByLocation((curr) => ({ ...curr, [newLoc.branchId]: [] }))
        setActiveLocation(newLoc.branchId as BranchLocationKey)
        setSelectedGameKey(null)
        setSelectedSubGameKey(null)
        setSuccess(`Location "${trimmed}" created.`)
        void refetchLocations()
      } catch {
        setError('Failed to create location.')
      } finally {
        setSaving(false)
      }
    },
    [allLocations, refetchLocations],
  )

  // -----------------------------------------------------------------------
  // Save support
  // -----------------------------------------------------------------------
  const uploadGameImages = useCallback(
    async (locationId: string, game: GameDraft): Promise<string[]> => {
      const urls: string[] = [...game.imageUrls]
      for (const file of game.imageFiles) {
        const fileName = file.name
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9._-]/g, '')
        const storagePath = `activities/${locationId}/games/${createGameDocumentId(game.name)}/${Date.now()}-${fileName || 'image'}`
        const uploaded = await uploadPipelineFile(storagePath, file, 'images')
        urls.push(uploaded.downloadUrl)
      }
      return urls
    },
    [],
  )

  const buildSavePayload = useCallback(
    async (drafts: GameDraft[]) => {
      const gamesPayload = []
      for (const game of drafts) {
        const imageUrls = await uploadGameImages(activeLocation, game)
        // The draft `key` doubles as the Firestore doc id for previously-
        // saved games. Fresh games carry a `draft_*` placeholder from
        // `createDraftKey()` and must not be sent through — the writer
        // mints an opaque id for those.
        const isPersistedKey = (key: string): boolean =>
          typeof key === 'string' && !!key && !key.startsWith('draft_')
        gamesPayload.push({
          id: isPersistedKey(game.key) ? game.key : undefined,
          name: game.name.trim(),
          imageUrl: imageUrls[0],
          status: game.status,
          platforms: game.platforms,
          metadata: {
            shortDescription: game.shortDescription.trim(),
            longDescription: game.longDescription.trim(),
            imageUrls,
            ...(game.gameType === 'vendor_game' || game.gameType === 'sub_lease'
              ? {
                  gameType: game.gameType,
                  vendorUserId: game.vendorUserId,
                  vendorId: game.vendorUserId,
                  vendorName: game.vendorName,
                  vendorBranchId: game.vendorBranchId,
                }
              : {}),
          },
          subGames: game.subGames.map((subGame) => ({
            id: isPersistedKey(subGame.key) ? subGame.key : undefined,
            name: subGame.name.trim(),
            metadata: {
              ...(subGame.notes.trim() ? { notes: subGame.notes.trim() } : {}),
              ...(subGame.platforms.length > 0 ? { platforms: subGame.platforms } : {}),
              ...(subGame.locationKeys.length > 0 ? { locationKeys: subGame.locationKeys } : {}),
            },
            // Persist the per-sub-game Interakt template choice as
            // first-class fields on the sub-game doc (read at confirmation
            // time). Empty string = inherit from BookingConfirmationConfig.
            ...(subGame.interaktTemplateId.trim()
              ? { interaktTemplateId: subGame.interaktTemplateId.trim() }
              : {}),
            ...(subGame.interaktTemplateLanguage.trim()
              ? { interaktTemplateLanguage: subGame.interaktTemplateLanguage.trim() }
              : {}),
            variants: subGame.variants.map((variant) => {
              const numericMetric = Math.max(0, Math.round(Number(variant.metricValue) || 0))
              const isCustomMetric =
                variant.metricType !== 'duration' && variant.metricType !== 'laps'
              const baseMeta: Record<string, unknown> = {}
              if (variant.notes.trim()) baseMeta.notes = variant.notes.trim()
              if (isCustomMetric) {
                baseMeta.metricType = variant.metricType
                baseMeta.metricValue = numericMetric
              }
              baseMeta.visibleInPOS = variant.visibleInPOS
              baseMeta.visibleInProtocol = variant.visibleInProtocol
              baseMeta.visibleInOffers = variant.visibleInOffers
              baseMeta.visibleInBooking = variant.visibleInBooking
              baseMeta.printIndividualTokens = variant.printIndividualTokens
              if (variant.visibleInOffers && variant.offerPrice.trim()) {
                baseMeta.offerPrice = Math.max(0, Number(variant.offerPrice) || 0)
              }
              return {
                id: isPersistedKey(variant.key) ? variant.key : undefined,
                label: variant.label.trim(),
                price: Math.max(0, Number(variant.price) || 0),
                durationMinutes: variant.metricType === 'duration' ? numericMetric : undefined,
                laps: variant.metricType === 'laps' ? numericMetric : undefined,
                active: variant.active,
                metadata: Object.keys(baseMeta).length > 0 ? baseMeta : {},
              }
            }),
          })),
        })
      }
      return {
        locationKey: activeLocation,
        locationName: currentLocationName,
        games: gamesPayload,
      }
    },
    [activeLocation, currentLocationName, uploadGameImages],
  )

  const performSave = useCallback(
    async (drafts: GameDraft[]) => {
      if (!token || !canManageActivities) throw new Error('Unauthorized')
      if (!isSaveable(drafts)) throw new Error('Data is not ready to save.')
      const payload = await buildSavePayload(drafts)
      await activitiesApi.replaceLocationHierarchy(token, payload)
      // Do NOT reload hierarchy here — it would create new draft objects
      // with different fingerprints, triggering another auto-save cycle.
      // The drafts in memory are already the source of truth.
    },
    [token, canManageActivities, buildSavePayload],
  )

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------
  const resetLocation = useCallback(() => {
    setError(null)
    setSuccess(null)
    const location = hierarchy.find((e) => e.id === activeLocation)
    setDraftsByLocation((curr) => ({
      ...curr,
      [activeLocation]: toDrafts(location),
    }))
  }, [hierarchy, activeLocation])

  return {
    hierarchy,
    draftsByLocation,
    currentDrafts,
    currentLocationName,
    availableLocations,
    approvedVendors,
    summaryItems,
    locationOptions,
    activeLocation,
    setActiveLocation,
    selectedGameKey,
    setSelectedGameKey,
    selectedGame,
    selectedSubGameKey,
    setSelectedSubGameKey,
    selectedSubGame,
    addGame,
    updateGame,
    removeGame,
    addSubGame,
    updateSubGame,
    removeSubGame,
    addVariant,
    updateVariant,
    removeVariant,
    toggleGameInLocation,
    handleImageChange,
    removeGameImage,
    handleAddLocation,
    buildSavePayload,
    performSave,
    loading,
    saving,
    error,
    setError,
    success,
    setSuccess,
    loadHierarchy,
    resetLocation,
    confirmDialog,
    setConfirmDialog,
    token,
    canManageActivities,
    isThirdParty,
    role,
  }
}
