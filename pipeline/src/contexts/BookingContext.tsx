/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useBooking hook co-located */
import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import type { Activity, BookingItem, LocationId, Location } from '../types'
import { isPeakHours, calculateComboDiscount } from '../lib/utils'
import { getAllLocations, normalizeStoredLocation } from '../lib/locations'

interface BookingState {
  selectedLocation: LocationId | null
  locations: Location[]
  loadingLocations: boolean
  selectedDate: string
  items: BookingItem[]
  totalAmount: number
  discountAmount: number
  finalAmount: number
  step: 'location' | 'activities' | 'datetime' | 'review' | 'payment'
}

type BookingAction =
  | { type: 'SET_LOCATION'; payload: LocationId }
  | { type: 'SET_LOCATIONS'; payload: Location[] }
  | { type: 'SET_LOADING_LOCATIONS'; payload: boolean }
  | { type: 'SET_DATE'; payload: string }
  | { type: 'ADD_ITEM'; payload: BookingItem }
  | { type: 'REMOVE_ITEM'; payload: number }
  | { type: 'UPDATE_ITEM'; payload: { index: number; item: BookingItem } }
  | { type: 'SET_STEP'; payload: BookingState['step'] }
  | { type: 'CLEAR_CART' }
  | { type: 'RECALCULATE_TOTALS' }

interface BookingContextType extends BookingState {
  setLocation: (locationId: LocationId) => void
  fetchLocations: () => Promise<void>
  setDate: (date: string) => void
  addItem: (activity: Activity, quantity: number, duration: number, timeSlot: string) => void
  removeItem: (index: number) => void
  updateItemQuantity: (index: number, quantity: number) => void
  setStep: (step: BookingState['step']) => void
  clearCart: () => void
  calculateItemPrice: (
    activity: Activity,
    quantity: number,
    duration: number,
    date: string,
    time: string,
  ) => number
}

const BookingContext = createContext<BookingContextType | null>(null)

const PERSIST_KEY = 'asquare_selected_location'

// Static locations — sourced from centralized registry. Computed once at
// module load (was previously recreated on every BookingProvider render,
// causing every consumer of `locations` to re-render).
const COMING_SOON_SLUGS = ['srikakulam']
const STATIC_LOCATIONS: Location[] = getAllLocations().map((l) => ({
  id: l.branchId,
  name: l.shortName,
  address: l.displayName,
  coordinates: { lat: 0, lng: 0 },
  image: '',
  isOpen: l.enabled,
  comingSoon: COMING_SOON_SLUGS.includes(l.slug),
  openingHours: { weekday: '10:00 - 22:00', weekend: '10:00 - 23:00' },
}))

const initialState: BookingState = {
  selectedLocation: normalizeStoredLocation(PERSIST_KEY),
  locations: [],
  loadingLocations: false,
  selectedDate: new Date().toISOString().split('T')[0],
  items: [],
  totalAmount: 0,
  discountAmount: 0,
  finalAmount: 0,
  step: 'location',
}

function calculateTotals(items: BookingItem[]): {
  totalAmount: number
  discountAmount: number
  finalAmount: number
} {
  const totalAmount = items.reduce((sum, item) => sum + item.price, 0)
  const discountPercent = calculateComboDiscount(items.length)
  const discountAmount = Math.floor(totalAmount * (discountPercent / 100))
  const finalAmount = totalAmount - discountAmount

  return { totalAmount, discountAmount, finalAmount }
}

function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case 'SET_LOCATION':
      return { ...state, selectedLocation: action.payload }

    case 'SET_LOCATIONS':
      return { ...state, locations: action.payload, loadingLocations: false }

    case 'SET_LOADING_LOCATIONS':
      return { ...state, loadingLocations: action.payload }

    case 'SET_DATE':
      return { ...state, selectedDate: action.payload }

    case 'ADD_ITEM': {
      const items = [...state.items, action.payload]
      return { ...state, items, ...calculateTotals(items) }
    }

    case 'REMOVE_ITEM': {
      const items = state.items.filter((_, idx) => idx !== action.payload)
      return { ...state, items, ...calculateTotals(items) }
    }

    case 'UPDATE_ITEM': {
      const items = [...state.items]
      items[action.payload.index] = action.payload.item
      return { ...state, items, ...calculateTotals(items) }
    }

    case 'SET_STEP':
      return { ...state, step: action.payload }

    case 'CLEAR_CART':
      return {
        ...initialState,
        selectedLocation: state.selectedLocation,
        locations: state.locations,
        loadingLocations: state.loadingLocations,
      }

    case 'RECALCULATE_TOTALS':
      return { ...state, ...calculateTotals(state.items) }

    default:
      return state
  }
}

export function BookingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(bookingReducer, initialState, (init) => ({
    ...init,
    selectedLocation: normalizeStoredLocation(PERSIST_KEY),
  }))

  const fetchLocations = useCallback(async () => {
    dispatch({ type: 'SET_LOCATIONS', payload: STATIC_LOCATIONS })
  }, [])

  // Load locations instantly on mount
  useEffect(() => {
    dispatch({ type: 'SET_LOCATIONS', payload: STATIC_LOCATIONS })
  }, [])

  const setLocation = useCallback((locationId: LocationId) => {
    localStorage.setItem(PERSIST_KEY, locationId)
    dispatch({ type: 'SET_LOCATION', payload: locationId })
  }, [])

  const setDate = useCallback((date: string) => {
    dispatch({ type: 'SET_DATE', payload: date })
  }, [])

  const calculateItemPrice = useCallback(
    (
      activity: Activity,
      quantity: number,
      duration: number,
      date: string,
      time: string,
    ): number => {
      const dateObj = new Date(date)
      const isPeak = isPeakHours(dateObj, time)
      const multiplier = isPeak ? activity.peakMultiplier || 1 : 1
      const durationMultiplier = duration / (activity.duration || 10)

      return Math.round(activity.basePrice * quantity * durationMultiplier * multiplier)
    },
    [],
  )

  // Location is selected by the user via LocationSelectPopup (shown on first visit)
  // or restored from localStorage. No auto-select — it would bypass the popup and
  // silently default every user to the first location (Vizag).

  const addItem = useCallback(
    (activity: Activity, quantity: number, duration: number, timeSlot: string) => {
      const price = calculateItemPrice(activity, quantity, duration, state.selectedDate, timeSlot)

      const item: BookingItem = {
        activity,
        quantity,
        duration,
        date: state.selectedDate,
        timeSlot,
        price,
      }

      dispatch({ type: 'ADD_ITEM', payload: item })
    },
    [calculateItemPrice, state.selectedDate],
  )

  const removeItem = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_ITEM', payload: index })
  }, [])

  const updateItemQuantity = useCallback(
    (index: number, quantity: number) => {
      const item = state.items[index]
      if (!item) return

      const price = calculateItemPrice(
        item.activity,
        quantity,
        item.duration,
        item.date,
        item.timeSlot,
      )
      const updatedItem = { ...item, quantity, price }

      dispatch({ type: 'UPDATE_ITEM', payload: { index, item: updatedItem } })
    },
    [calculateItemPrice, state.items],
  )

  const setStep = useCallback((step: BookingState['step']) => {
    dispatch({ type: 'SET_STEP', payload: step })
  }, [])

  const clearCart = useCallback(() => {
    dispatch({ type: 'CLEAR_CART' })
  }, [])

  const value = useMemo<BookingContextType>(
    () => ({
      ...state,
      setLocation,
      fetchLocations,
      setDate,
      addItem,
      removeItem,
      updateItemQuantity,
      setStep,
      clearCart,
      calculateItemPrice,
    }),
    [
      state,
      setLocation,
      fetchLocations,
      setDate,
      addItem,
      removeItem,
      updateItemQuantity,
      setStep,
      clearCart,
      calculateItemPrice,
    ],
  )

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>
}

export function useBooking() {
  const context = useContext(BookingContext)
  if (!context) {
    throw new Error('useBooking must be used within a BookingProvider')
  }
  return context
}
