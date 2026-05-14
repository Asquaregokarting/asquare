/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useCart hook co-located */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import type { Activity } from '../types'
import { couponService, type Coupon } from '../services/couponService'
import { useAuth } from './AuthContext'
import { getLocalISODate } from '../lib/utils'
import { logger } from '../lib/logger'
import { calculateBuyXGetYFree } from '../pipeline/features/event-campaigns/event-pricing'

/** Minimum cart total required to use a member ₹150 coupon. */
const MEMBER_COUPON_MIN_AMOUNT = 600

/** Returns true when the coupon is a user-specific ₹150 member coupon. */
function isMember150Coupon(coupon: Coupon): boolean {
  return !!coupon.userId && coupon.discount === 150
}

/** Returns true when the cart contains at least one gokarting activity. */
function cartHasGokarting(items: CartItem[]): boolean {
  return items.some((item) => {
    const cat = (item.activity.category || '').toLowerCase()
    return cat === 'gokarting'
  })
}

export interface CartItem {
  activity: Activity
  quantity: number
  date: string
  timeSlot?: string
}

interface CartContextType {
  items: CartItem[]
  addItem: (activity: Activity, quantity?: number, date?: string) => void
  removeItem: (activityId: string) => void
  updateQuantity: (activityId: string, quantity: number) => void
  clearCart: () => void
  getTotal: () => number
  getDiscountedTotal: (couponCode?: string) => {
    total: number
    discount: number
    cashback: number
    code: string | null
  }
  getItemQuantity: (activityId: string) => number
  itemCount: number
  appliedCoupon: string | null
  applyCoupon: (code: string) => string | true
  removeCoupon: () => void
  coupons: Coupon[]
  cartDate: string
  setCartDate: (date: string) => void
  isUsingWallet: boolean
  setIsUsingWallet: (value: boolean) => void
  hasGokartingActivity: () => boolean
}

const CartContext = createContext<CartContextType | null>(null)

interface DiscountResult {
  total: number
  discount: number
  cashback: number
  code: string | null
}

/**
 * Pure helper that computes the discounted total for a cart given a coupon.
 * Extracted from inline duplication so the "preview" path and the "applied"
 * path share one source of truth.
 */
function calculateDiscount(
  cartTotal: number,
  couponCode: string | null,
  coupons: Coupon[],
  items: CartItem[],
  cartDate: string,
  isUsingWallet: boolean,
): DiscountResult {
  const total = cartTotal

  if (isUsingWallet) {
    return { total, discount: 0, cashback: 0, code: null }
  }
  if (!couponCode) {
    return { total, discount: 0, cashback: 0, code: null }
  }

  const coupon = coupons.find((c) => c.code === couponCode)
  if (!coupon || total < coupon.minAmount) {
    return { total, discount: 0, cashback: 0, code: null }
  }

  // Member ₹150 coupons: enforce ₹600 minimum and gokarting-only
  if (isMember150Coupon(coupon)) {
    if (total < MEMBER_COUPON_MIN_AMOUNT || !cartHasGokarting(items)) {
      return { total, discount: 0, cashback: 0, code: null }
    }
  }

  const requiredTickets =
    coupon.code === 'ASG1000' || coupon.code === 'ASG600'
      ? Math.max(6, coupon.minTickets || 0)
      : coupon.minTickets || 0
  if (requiredTickets > 0) {
    const ticketCount = items.reduce((sum, item) => sum + item.quantity, 0)
    if (ticketCount < requiredTickets) {
      return { total, discount: 0, cashback: 0, code: null }
    }
  }

  // Date-restricted coupons must match the active cart date when previewing too.
  if (coupon.validDates && coupon.validDates.length > 0 && !coupon.validDates.includes(cartDate)) {
    return { total, discount: 0, cashback: 0, code: null }
  }

  const isCashback = coupon.type === 'cashback' || coupon.code === 'RD26'

  let effectiveDiscount = coupon.isPercentage
    ? Math.round((total * (Number(coupon.discount) || 0)) / 100)
    : Number(coupon.discount) || 0

  if (!coupon.isPercentage && coupon.applyPerTicket) {
    const count = items.reduce((sum, item) => sum + item.quantity, 0)
    effectiveDiscount = effectiveDiscount * count
  }

  if (isCashback) {
    return { total, discount: 0, cashback: effectiveDiscount, code: couponCode }
  }
  return {
    total: total - effectiveDiscount,
    discount: effectiveDiscount,
    cashback: 0,
    code: couponCode,
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [items, setItems] = useState<CartItem[]>(() => {
    // A single corrupt entry would otherwise crash CartProvider's render and
    // blank the entire app for the customer until they manually clear storage.
    const saved = localStorage.getItem('asquare_cart_items')
    if (!saved) return []
    try {
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? (parsed as CartItem[]) : []
    } catch (err) {
      logger.warn('cart.storage_corrupt', { err })
      localStorage.removeItem('asquare_cart_items')
      return []
    }
  })
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(() => {
    return localStorage.getItem('asquare_applied_coupon')
  })
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [isUsingWallet, setIsUsingWallet] = useState(false)
  const [cartDate, setCartDate] = useState<string>(() => {
    const today = getLocalISODate()
    const saved = localStorage.getItem('asquare_cart_date')
    // Only use saved date if it's today or in the future
    if (saved && saved >= today) {
      return saved
    }
    return today
  })

  // Auto-reset date if it's in the past (e.g. user left tab open overnight)
  useEffect(() => {
    const today = getLocalISODate()
    if (cartDate < today) {
      setCartDate(today)
    }
  }, [cartDate])

  // Persist cart items to localStorage
  useEffect(() => {
    localStorage.setItem('asquare_cart_items', JSON.stringify(items))
  }, [items])

  // Persist cart date to localStorage
  useEffect(() => {
    localStorage.setItem('asquare_cart_date', cartDate)
  }, [cartDate])

  // Persist applied coupon to localStorage
  useEffect(() => {
    if (appliedCoupon) {
      localStorage.setItem('asquare_applied_coupon', appliedCoupon)
    } else {
      localStorage.removeItem('asquare_applied_coupon')
    }
  }, [appliedCoupon])

  // Load coupons (global + user rewards) on mount and when user changes
  useEffect(() => {
    const loadCoupons = async () => {
      const [globalCoupons, userCoupons] = await Promise.all([
        couponService.fetchCoupons(),
        user?.id ? couponService.fetchUserCoupons(user.id) : Promise.resolve([]),
      ])
      setCoupons([...userCoupons, ...globalCoupons])
    }
    loadCoupons()
  }, [user?.id])

  const addItem = useCallback(
    (activity: Activity, quantity = 1) => {
      setItems((prev) => {
        const existing = prev.find((item) => item.activity.id === activity.id)
        if (existing) {
          return prev.map((item) =>
            item.activity.id === activity.id
              ? { ...item, quantity: item.quantity + quantity, date: cartDate }
              : item,
          )
        }
        return [
          ...prev,
          {
            activity,
            quantity,
            date: cartDate,
          },
        ]
      })
    },
    [cartDate],
  )

  // Update all items when global date changes
  useEffect(() => {
    setItems((prev) => prev.map((item) => ({ ...item, date: cartDate })))
  }, [cartDate])

  const removeItem = useCallback((activityId: string) => {
    setItems((prev) => prev.filter((item) => item.activity.id !== activityId))
  }, [])

  const updateQuantity = useCallback(
    (activityId: string, quantity: number) => {
      if (quantity <= 0) {
        removeItem(activityId)
        return
      }
      setItems((prev) =>
        prev.map((item) => (item.activity.id === activityId ? { ...item, quantity } : item)),
      )
    },
    [removeItem],
  )

  const clearCart = useCallback(() => {
    setItems([])
    setAppliedCoupon(null)
  }, [])

  // Re-evaluate BOGO free lines whenever the cart changes. A free line item
  // carries a `__bogoTie` describing which paid parent(s) earn it and the
  // buy/get rule. When the parent qty drops below threshold (or hits zero),
  // the free line's quantity is reduced or the line is dropped entirely.
  // This fixes the case where a user added 2 paid items (earning 1 free),
  // then removed the paid ones — leaving the free item in the cart.
  useEffect(() => {
    const freeLines = items.filter((i) => i.activity.__bogoTie)
    if (freeLines.length === 0) return

    // Group free lines by tie fingerprint so mixed-mode pools are computed once.
    type Group = { tie: NonNullable<Activity['__bogoTie']>; frees: CartItem[] }
    const groups = new Map<string, Group>()
    for (const line of freeLines) {
      const tie = line.activity.__bogoTie
      if (!tie) continue
      const key = JSON.stringify({
        parentIds: [...tie.parentIds].sort(),
        buyCount: tie.buyCount,
        getCount: tie.getCount,
        mode: tie.mode,
      })
      const existing = groups.get(key)
      if (existing) existing.frees.push(line)
      else groups.set(key, { tie, frees: [line] })
    }

    // Compute the desired quantity for each tied free line id.
    const desired = new Map<string, number>()
    for (const { tie, frees } of groups.values()) {
      const parentSelections = tie.parentIds
        .map((pid) => {
          const p = items.find((i) => i.activity.id === pid)
          // calculateBuyXGetYFree expects TOTAL units (paid + free) per parent
          // — it derives `freeQty = floor(total / groupSize) * getCount`. The
          // EventPage already split the user's selection into paid + free
          // lines, so the paid line alone is below the threshold. Re-add the
          // tied free line's quantity so the threshold check reflects what
          // the user originally chose.
          const tiedFree = items.find((i) => i.activity.id === `${pid}-free`)
          return {
            activityId: pid,
            unitPrice: p?.activity.basePrice ?? 0,
            quantity: (p?.quantity ?? 0) + (tiedFree?.quantity ?? 0),
          }
        })
        .filter((s) => s.quantity > 0)

      if (tie.buyCount <= 0 || tie.getCount <= 0 || parentSelections.length === 0) {
        for (const f of frees) desired.set(f.activity.id, 0)
        continue
      }

      const result = calculateBuyXGetYFree(
        parentSelections,
        tie.buyCount,
        tie.getCount,
        tie.mode === 'mixed',
      )
      const freeByParent = new Map(result.items.map((i) => [i.activityId, i.freeQty]))

      for (const f of frees) {
        const id = f.activity.id
        const parentId = id.endsWith('-free') ? id.slice(0, -'-free'.length) : null
        desired.set(id, parentId ? (freeByParent.get(parentId) ?? 0) : 0)
      }
    }

    // Bail if nothing would change — prevents the effect from thrashing the
    // items array and triggering itself in a loop.
    const needsUpdate = Array.from(desired.entries()).some(([id, qty]) => {
      const current = items.find((i) => i.activity.id === id)
      return (current?.quantity ?? 0) !== qty
    })
    if (!needsUpdate) return

    setItems((prev) =>
      prev.flatMap<CartItem>((item) => {
        if (!desired.has(item.activity.id)) return [item]
        const target = desired.get(item.activity.id) ?? 0
        if (target <= 0) return []
        if (target === item.quantity) return [item]
        return [{ ...item, quantity: target }]
      }),
    )
  }, [items])

  const cartTotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const price = item.activity.offerPercent
        ? Math.round(item.activity.basePrice * (1 - item.activity.offerPercent / 100))
        : item.activity.basePrice
      return sum + price * item.quantity
    }, 0)
  }, [items])

  const getTotal = useCallback(() => cartTotal, [cartTotal])

  const discountedTotalResult = useMemo(
    () => calculateDiscount(cartTotal, appliedCoupon, coupons, items, cartDate, isUsingWallet),
    [cartTotal, appliedCoupon, coupons, items, cartDate, isUsingWallet],
  )

  const getDiscountedTotal = useCallback(
    (couponCode?: string) => {
      if (couponCode && couponCode !== appliedCoupon) {
        return calculateDiscount(cartTotal, couponCode, coupons, items, cartDate, isUsingWallet)
      }
      return discountedTotalResult
    },
    [discountedTotalResult, cartTotal, coupons, isUsingWallet, appliedCoupon, items, cartDate],
  )

  const applyCoupon = useCallback(
    (code: string): string | true => {
      const upperCode = code.toUpperCase()
      const coupon = coupons.find((c) => c.code === upperCode)
      if (!coupon) {
        return 'Invalid coupon code'
      }

      // Restrict specific coupons to only be valid for Helicopter joy rides
      if (coupon.isForHelicopterOnly) {
        const hasHelicopter = items.some((item) => {
          const cat = (item.activity.category || '').toLowerCase()
          const name = (item.activity.name || '').toLowerCase()
          return cat.includes('helicopter') || name.includes('helicopter')
        })
        const hasNonHelicopter = items.some((item) => {
          const cat = (item.activity.category || '').toLowerCase()
          const name = (item.activity.name || '').toLowerCase()
          return !cat.includes('helicopter') && !name.includes('helicopter')
        })
        if (!hasHelicopter) {
          return 'A helicopter joy ride is required for this coupon'
        }
        if (hasNonHelicopter) {
          return 'This coupon is only valid for helicopter joy rides'
        }
      }

      // Member ₹150 coupons: must have gokarting in cart and meet ₹600 minimum
      if (isMember150Coupon(coupon)) {
        if (!cartHasGokarting(items)) {
          return 'This coupon is only valid for Go-Karting activities'
        }
        const total = getTotal()
        if (total < MEMBER_COUPON_MIN_AMOUNT) {
          return `Minimum cart amount of ₹${MEMBER_COUPON_MIN_AMOUNT} required for this coupon`
        }
      }

      // Check excluded categories (e.g., WELCOME200 not valid for Helicopter)
      if (coupon.excludeCategories && coupon.excludeCategories.length > 0) {
        const excluded = coupon.excludeCategories.map((c) => c.toLowerCase())
        const hasExcluded = items.some((item) => {
          const cat = (item.activity.category || '').toLowerCase()
          const name = (item.activity.name || '').toLowerCase()
          return excluded.some((e) => cat.includes(e) || name.includes(e))
        })
        if (hasExcluded) {
          return `This coupon is not valid for ${coupon.excludeCategories.join(', ')} bookings`
        }
      }
      // Check valid dates (e.g., FEB14 only on 14th Feb)
      if (coupon.validDates && coupon.validDates.length > 0) {
        if (!coupon.validDates.includes(cartDate)) {
          const dateLabels = coupon.validDates
            .map((d) => {
              const [, m, day] = d.split('-')
              const months = [
                'Jan',
                'Feb',
                'Mar',
                'Apr',
                'May',
                'Jun',
                'Jul',
                'Aug',
                'Sep',
                'Oct',
                'Nov',
                'Dec',
              ]
              return `${parseInt(day)} ${months[parseInt(m) - 1]}`
            })
            .join(', ')
          return `This coupon is only valid for visits on ${dateLabels}`
        }
      }
      // Check expiry
      if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
        return 'This coupon has expired'
      }
      // Check usage limit
      if (
        coupon.maxUsageCount &&
        coupon.maxUsageCount > 0 &&
        (coupon.usedCount ?? 0) >= coupon.maxUsageCount
      ) {
        return 'This coupon has reached its usage limit'
      }
      // Check minimum amount
      const total = getTotal()
      if (total < coupon.minAmount) {
        return `Minimum cart amount of \u20b9${coupon.minAmount} required`
      }

      const requiredTickets =
        coupon.code === 'ASG1000' || coupon.code === 'ASG600'
          ? Math.max(6, coupon.minTickets || 0)
          : coupon.minTickets || 0
      if (requiredTickets && requiredTickets > 0) {
        const ticketCount = items.reduce((sum, item) => sum + item.quantity, 0)
        if (ticketCount < requiredTickets) {
          return `Minimum ${requiredTickets} tickets required to use this coupon`
        }
      }

      setAppliedCoupon(upperCode)
      return true
    },
    [getTotal, coupons, cartDate, items],
  )

  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null)
  }, [])

  // Auto-remove invalid coupons when cart changes
  useEffect(() => {
    if (!appliedCoupon) return

    const checkCouponValidity = () => {
      const coupon = coupons.find((c) => c.code === appliedCoupon)
      if (!coupon) return false

      if (cartTotal < coupon.minAmount) return false

      // Member ₹150 coupons: require gokarting activity and ₹600 minimum
      if (isMember150Coupon(coupon)) {
        if (cartTotal < MEMBER_COUPON_MIN_AMOUNT || !cartHasGokarting(items)) return false
      }

      const requiredTickets =
        coupon.code === 'ASG1000' || coupon.code === 'ASG600'
          ? Math.max(6, coupon.minTickets || 0)
          : coupon.minTickets || 0
      if (requiredTickets && requiredTickets > 0) {
        const ticketCount = items.reduce((sum, item) => sum + item.quantity, 0)
        if (ticketCount < requiredTickets) return false
      }

      if (coupon.isForHelicopterOnly) {
        const hasHelicopter = items.some((item) => {
          const cat = (item.activity.category || '').toLowerCase()
          const name = (item.activity.name || '').toLowerCase()
          return cat.includes('helicopter') || name.includes('helicopter')
        })
        const hasNonHelicopter = items.some((item) => {
          const cat = (item.activity.category || '').toLowerCase()
          const name = (item.activity.name || '').toLowerCase()
          return !cat.includes('helicopter') && !name.includes('helicopter')
        })
        if (!hasHelicopter || hasNonHelicopter) return false
      }

      if (coupon.excludeCategories && coupon.excludeCategories.length > 0) {
        const excluded = coupon.excludeCategories.map((c) => c.toLowerCase())
        const hasExcluded = items.some((item) => {
          const cat = (item.activity.category || '').toLowerCase()
          const name = (item.activity.name || '').toLowerCase()
          return excluded.some((e) => cat.includes(e) || name.includes(e))
        })
        if (hasExcluded) return false
      }

      if (coupon.validDates && coupon.validDates.length > 0) {
        if (!coupon.validDates.includes(cartDate)) return false
      }

      if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
        return false
      }

      return true
    }

    if (!checkCouponValidity()) {
      setAppliedCoupon(null)
    }
  }, [items, cartTotal, appliedCoupon, coupons, cartDate])

  const getItemQuantity = useCallback(
    (activityId: string): number => {
      const item = items.find((i) => i.activity.id === activityId)
      return item ? item.quantity : 0
    },
    [items],
  )

  const itemCount = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items])

  const hasGokartingActivity = useCallback(
    () =>
      items.some((item) => {
        const name = (item.activity.name || '').toLowerCase()
        const cat = (item.activity.category || '').toLowerCase()
        return name.includes('kart') || cat.includes('kart')
      }),
    [items],
  )

  // Memoize the provider value so consumers using `useCart()` only re-render
  // when one of these dependencies actually changes. Without this, the value
  // object identity changes on every parent render and cascades through every
  // page that subscribes (Activities, Header, Cart, Checkout, MyBookings, ...).
  const value = useMemo<CartContextType>(
    () => ({
      items,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      getTotal,
      getDiscountedTotal,
      getItemQuantity,
      itemCount,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      coupons,
      cartDate,
      setCartDate,
      isUsingWallet,
      setIsUsingWallet,
      hasGokartingActivity,
    }),
    [
      items,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      getTotal,
      getDiscountedTotal,
      getItemQuantity,
      itemCount,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      coupons,
      cartDate,
      isUsingWallet,
      hasGokartingActivity,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
