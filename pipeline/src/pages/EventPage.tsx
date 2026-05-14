import { useCallback, useEffect, useMemo, useState } from 'react'
import SEO from '../components/SEO'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Gift, CalendarDays, MapPin, Plus, Minus, ShoppingCart } from 'lucide-react'
import { useCart } from '../contexts/CartContext'
import { getEventBySlug } from '../services/eventService'
import {
  getEventGamePrice,
  calculateEventCartSummary,
  calculatePackageTotal,
  computePackageDiscount,
  isPackageEnabled,
  isItemEnabled,
  isLocationActive,
  type PackageDiscountLine,
  type PackageDiscountResult,
} from '../pipeline/features/event-campaigns/event-pricing'
import type {
  EventCampaignRecord,
  EventPackage,
} from '../pipeline/features/event-campaigns/event-campaign-types'
import type { EventPackageCartAttachment } from '../pipeline/features/event-campaigns/event-package-ledger'
import type { Activity, BogoTie } from '../types'
import { formatCurrency } from '../lib/utils'
import { branchIdToDisplayName, resolveLocation } from '../lib/locations'
import EventDateCarousel from '../components/EventDateCarousel'

// Neutral brand image — previously was a helicopter banner, which made
// every image-less event look like a helicopter promo.
const DEFAULT_HERO = '/asquare-logo.webp'
const isVideoUrl = (url: string): boolean => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)

const EventPage = () => {
  const { eventSlug } = useParams<{ eventSlug: string }>()
  const navigate = useNavigate()
  const { addItem } = useCart()

  const [event, setEvent] = useState<EventCampaignRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not_found' | 'ended' | null>(null)
  const [selections, setSelections] = useState<Map<string, number>>(new Map())
  const [selectedPackages, setSelectedPackages] = useState<Map<string, number>>(new Map())
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedLocation, setSelectedLocation] = useState<string>('')

  useEffect(() => {
    if (!eventSlug) {
      setError('not_found')
      setLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const record = await getEventBySlug(eventSlug)
      if (cancelled) return
      if (!record) {
        setError('not_found')
      } else if (record.status === 'ended' || record.status === 'inactive') {
        setEvent(record)
        setError('ended')
      } else {
        const today = new Date().toISOString().slice(0, 10)
        if (record.endDate && today > record.endDate) {
          setEvent(record)
          setError('ended')
        } else {
          setEvent(record)
        }
        // Default the booking date: event.startDate if it's today or later,
        // otherwise today (event is already running).
        const todayIso = new Date().toISOString().slice(0, 10)
        const defaultDate =
          record.startDate && record.startDate > todayIso ? record.startDate : todayIso
        setSelectedDate(defaultDate)
        const firstActive = record.locationKeys.find((k) => isLocationActive(record, k))
        if (firstActive) {
          setSelectedLocation(firstActive)
        }
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventSlug])

  const cartSummary = useMemo(() => {
    if (!event) return { subtotal: 0, savings: 0, total: 0, freeByGame: new Map<string, number>() }
    return calculateEventCartSummary(selections, event)
  }, [event, selections])

  const activeLocationKeys = useMemo<string[]>(() => {
    if (!event) return []
    // Legacy campaigns store both branchIds ('0','1','2') and slugs
    // ('visakhapatnam',…) for the same place — dedupe by canonical slug so the
    // public selector shows each branch once.
    const seen = new Set<string>()
    const out: string[] = []
    for (const key of event.locationKeys) {
      if (!isLocationActive(event, key)) continue
      const canonical = resolveLocation(key)?.slug ?? key.toLowerCase()
      if (seen.has(canonical)) continue
      seen.add(canonical)
      out.push(key)
    }
    return out
  }, [event])

  // Only show enabled packages assigned to a location that hasn't been paused.
  // Match by canonical slug so legacy campaigns that store branchIds and slugs
  // for the same branch still resolve correctly.
  const visiblePackages = useMemo<EventPackage[]>(() => {
    const pkgs = (event?.packages ?? [])
      .filter(isPackageEnabled)
      .map((pkg) => ({ ...pkg, items: pkg.items.filter(isItemEnabled) }))
    if (!event) return pkgs
    const targetSlug = selectedLocation
      ? (resolveLocation(selectedLocation)?.slug ?? selectedLocation.toLowerCase())
      : ''
    return pkgs.filter((pkg) => {
      if (!isLocationActive(event, pkg.locationKey)) return false
      if (!targetSlug) return true
      const pkgSlug = resolveLocation(pkg.locationKey)?.slug ?? pkg.locationKey.toLowerCase()
      return pkgSlug === targetSlug
    })
  }, [event, selectedLocation])

  const selectedPackagesList = useMemo<Array<{ pkg: EventPackage; quantity: number }>>(() => {
    if (!event) return []
    const out: Array<{ pkg: EventPackage; quantity: number }> = []
    for (const pkg of visiblePackages) {
      const qty = selectedPackages.get(pkg.id) ?? 0
      if (qty > 0) out.push({ pkg, quantity: qty })
    }
    return out
  }, [event, visiblePackages, selectedPackages])

  const packageDiscountResult = useMemo<PackageDiscountResult>(() => {
    const lines: PackageDiscountLine[] = selectedPackagesList.map(({ pkg, quantity }) => ({
      packageId: pkg.id,
      unitPrice: calculatePackageTotal(pkg),
      quantity,
    }))
    return computePackageDiscount(lines, event?.packageDiscount ?? null)
  }, [event, selectedPackagesList])

  const selectedPackageUnitCount = useMemo(
    () => selectedPackagesList.reduce((s, { quantity }) => s + quantity, 0),
    [selectedPackagesList],
  )

  const totalItems = useMemo(
    () => Array.from(selections.values()).reduce((s, v) => s + v, 0) + selectedPackageUnitCount,
    [selections, selectedPackageUnitCount],
  )

  const incPackage = useCallback((pkgId: string) => {
    setSelectedPackages((prev) => {
      const next = new Map(prev)
      next.set(pkgId, (next.get(pkgId) ?? 0) + 1)
      return next
    })
  }, [])

  const decPackage = useCallback((pkgId: string) => {
    setSelectedPackages((prev) => {
      const next = new Map(prev)
      const qty = (next.get(pkgId) ?? 0) - 1
      if (qty <= 0) next.delete(pkgId)
      else next.set(pkgId, qty)
      return next
    })
  }, [])

  const handleAdd = useCallback((activityId: string) => {
    setSelections((prev) => {
      const next = new Map(prev)
      next.set(activityId, (next.get(activityId) ?? 0) + 1)
      return next
    })
  }, [])

  const handleRemove = useCallback((activityId: string) => {
    setSelections((prev) => {
      const next = new Map(prev)
      const qty = (next.get(activityId) ?? 0) - 1
      if (qty <= 0) next.delete(activityId)
      else next.set(activityId, qty)
      return next
    })
  }, [])

  const handleProceed = () => {
    if (!event || totalItems === 0) return
    setIsProcessing(true)

    // Split each selected package into paid + free synthetic Activities based on
    // the campaign's discount config. For flat discount, scale paid unit prices
    // (and their embedded __eventPackage.items prices) proportionally so the
    // post-payment vendor-ledger writer uses the discounted amounts.
    const freeByPackage = packageDiscountResult.freeByPackage
    const flatRatio =
      packageDiscountResult.flatValue > 0 && packageDiscountResult.subtotal > 0
        ? packageDiscountResult.flatValue / packageDiscountResult.subtotal
        : 0

    for (const { pkg, quantity: qty } of selectedPackagesList) {
      const freeQty = freeByPackage.get(pkg.id) ?? 0
      const paidQty = qty - freeQty
      const fullUnit = calculatePackageTotal(pkg)

      if (paidQty > 0) {
        const scaledUnit = Math.round(fullUnit * (1 - flatRatio))
        const scaledItems = pkg.items.map((it) => ({
          ...it,
          price: Math.round((Number(it.price) || 0) * (1 - flatRatio)),
        }))
        const paidAttachment: EventPackageCartAttachment = {
          campaignId: event.id,
          packageId: pkg.id,
          locationKey: pkg.locationKey,
          items: scaledItems,
        }
        const paidActivity: Activity & { __eventPackage?: EventPackageCartAttachment } = {
          id: `event-${event.id}-pkg-${pkg.id}`,
          name: `${event.title} — ${pkg.title || 'Package'}`,
          description: pkg.items.map((it) => it.name).join(' · '),
          basePrice: scaledUnit,
          category: event.title,
          image: event.heroImageUrl || DEFAULT_HERO,
          __eventPackage: paidAttachment,
        }
        addItem(paidActivity, paidQty, selectedDate)
      }

      if (freeQty > 0) {
        // Keep the ORIGINAL item prices in the cart attachment so the
        // post-payment vendor-ledger writer (onBookingPaid) credits the
        // vendor for BxGy free units — the company absorbs the customer-
        // facing discount, but the vendor is paid in full. The activity's
        // top-level basePrice stays 0 so the cart/checkout still display
        // "FREE" to the customer.
        const freeAttachment: EventPackageCartAttachment = {
          campaignId: event.id,
          packageId: pkg.id,
          locationKey: pkg.locationKey,
          items: pkg.items.map((it) => ({ ...it })),
        }
        const bogoTie: BogoTie = {
          parentIds: selectedPackagesList.map(({ pkg: p }) => `event-${event.id}-pkg-${p.id}`),
          buyCount: Math.max(1, Math.floor(Number(event.packageDiscount?.buyCount) || 0)),
          getCount: Math.max(0, Math.floor(Number(event.packageDiscount?.getCount) || 0)),
          mode: 'mixed',
        }
        const freeActivity: Activity & { __eventPackage?: EventPackageCartAttachment } = {
          id: `event-${event.id}-pkg-${pkg.id}-free`,
          name: `${event.title} — ${pkg.title || 'Package'} (FREE)`,
          description: pkg.items.map((it) => it.name).join(' · '),
          basePrice: 0,
          category: event.title,
          image: event.heroImageUrl || DEFAULT_HERO,
          __eventPackage: freeAttachment,
          __bogoTie: bogoTie,
        }
        addItem(freeActivity, freeQty, selectedDate)
      }
    }

    const legacyGames = event.games ?? []
    const gameMap = new Map(legacyGames.map((g) => [g.activityId, g]))
    const { freeByGame } = cartSummary

    for (const [activityId, qty] of selections) {
      if (qty <= 0) continue
      const game = gameMap.get(activityId)
      if (!game) continue

      const effectivePrice = getEventGamePrice(game, event.offer ?? null)
      const freeQty = freeByGame.get(activityId) ?? 0
      const paidQty = qty - freeQty

      if (paidQty > 0) {
        const paidActivity: Activity = {
          id: `event-${event.id}-${activityId}`,
          name: `${event.title} — ${game.gameName}`,
          description: game.variantLabel,
          basePrice: effectivePrice,
          category: event.title,
          image: game.image || event.heroImageUrl || DEFAULT_HERO,
        }
        addItem(paidActivity, paidQty, selectedDate)
      }

      if (freeQty > 0) {
        const bogoTie: BogoTie = event.offer?.mixedGames
          ? {
              parentIds: Array.from(selections.keys())
                .filter((id) => (selections.get(id) ?? 0) > 0)
                .map((id) => `event-${event.id}-${id}`),
              buyCount: Math.max(1, Math.floor(Number(event.offer?.buyCount) || 0)),
              getCount: Math.max(0, Math.floor(Number(event.offer?.freeCount) || 0)),
              mode: 'mixed',
            }
          : {
              parentIds: [`event-${event.id}-${activityId}`],
              buyCount: Math.max(1, Math.floor(Number(event.offer?.buyCount) || 0)),
              getCount: Math.max(0, Math.floor(Number(event.offer?.freeCount) || 0)),
              mode: 'per_item',
            }
        const freeActivity: Activity = {
          id: `event-${event.id}-${activityId}-free`,
          name: `${event.title} — ${game.gameName} (FREE)`,
          description: game.variantLabel,
          basePrice: 0,
          category: event.title,
          image: game.image || event.heroImageUrl || DEFAULT_HERO,
          __bogoTie: bogoTie,
        }
        addItem(freeActivity, freeQty, selectedDate)
      }
    }

    navigate('/cart')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-950 text-white">
        <p className="text-sm text-dark-400">Loading event...</p>
      </div>
    )
  }

  if (error === 'not_found') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-dark-950 text-white">
        <p className="text-lg font-bold">Event Not Found</p>
        <p className="text-sm text-dark-400">
          This event may have been removed or the link is incorrect.
        </p>
        <button
          onClick={() => navigate('/activities')}
          className="rounded-xl bg-primary-500 px-6 py-3 text-sm font-bold text-white"
        >
          Browse Activities
        </button>
      </div>
    )
  }

  if (!event) return null

  const heroImage = event.heroImageUrl || DEFAULT_HERO

  return (
    <div className="min-h-screen bg-dark-950 font-sans text-white">
      {/* Fixed Hero Banner */}
      {event && (
        <SEO
          title={event.title}
          description={event.description || `${event.title} at A Square GoKarting`}
          path={`/event/${eventSlug}`}
          image={event.heroImageUrl || undefined}
        />
      )}
      <div className="fixed inset-x-0 top-0 z-0 h-[60vh] min-h-[350px] md:h-[50vh] lg:h-[55vh]">
        {event.heroImageUrl && isVideoUrl(event.heroImageUrl) ? (
          <video
            src={event.heroImageUrl}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover opacity-80"
          />
        ) : (
          <img
            src={heroImage}
            alt={event.title}
            loading="eager"
            className="absolute inset-0 h-full w-full object-cover opacity-80"
            onError={(e) => {
              ;(e.target as HTMLImageElement).src = DEFAULT_HERO
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-dark-950/40 via-transparent to-dark-950" />
      </div>

      {/* Back Button */}
      <div className="fixed inset-x-0 top-0 z-50 p-4">
        <motion.button
          onClick={() => navigate(-1)}
          className="flex h-10 items-center gap-2 rounded-full border border-white/20 bg-dark-950/50 px-4 shadow-lg backdrop-blur-md transition-colors hover:bg-dark-950/70"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="text-sm font-medium">Back</span>
        </motion.button>
      </div>

      {/* Spacer */}
      <div className="h-[50vh] min-h-[300px] md:h-[40vh] lg:h-[45vh]" />

      {/* Content */}
      <div className="relative z-10 -mt-10 mx-auto max-w-lg px-4 pb-32 md:max-w-2xl md:px-6 lg:max-w-5xl lg:px-8 xl:max-w-6xl">
        <div className="lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-8 xl:grid-cols-[1fr_420px]">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Event Info Card */}
            <div className="rounded-2xl border border-white/10 bg-dark-900/90 p-5 backdrop-blur-xl md:p-6">
              {event.promoText && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-gradient-to-r from-orange-500/20 to-red-500/20 px-3 py-1.5">
                  <Gift className="h-3.5 w-3.5 text-orange-400" />
                  <span className="text-xs font-bold text-orange-300">{event.promoText}</span>
                </div>
              )}

              <h1 className="text-2xl font-bold md:text-3xl lg:text-4xl">{event.title}</h1>
              {event.description && (
                <p className="mt-2 text-sm leading-relaxed text-white/60">{event.description}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-dark-300">
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-primary-400" />
                  <span>
                    {event.startDate} — {event.endDate}
                  </span>
                </div>
                {activeLocationKeys.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-primary-400" />
                    <span>
                      {activeLocationKeys.map((k) => branchIdToDisplayName(k) || k).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {error !== 'ended' && event.startDate && event.endDate && (
                <EventDateCarousel
                  eventId={event.id}
                  startDate={event.startDate}
                  endDate={event.endDate}
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                />
              )}

              {error !== 'ended' && activeLocationKeys.length > 1 && (
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-white">
                    Select Location
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeLocationKeys.map((key) => {
                      const label = branchIdToDisplayName(key) || key
                      const isSelected = key === selectedLocation
                      return (
                        <motion.button
                          key={key}
                          type="button"
                          onClick={() => setSelectedLocation(key)}
                          whileTap={{ scale: 0.96 }}
                          className={[
                            'flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all',
                            isSelected
                              ? 'border-primary-400 bg-primary-500/10 text-white ring-2 ring-primary-500 shadow-md shadow-primary-500/20'
                              : 'border-white/10 bg-dark-900/60 text-dark-300 hover:border-white/20 hover:text-white',
                          ].join(' ')}
                        >
                          <MapPin
                            className={`h-3.5 w-3.5 ${isSelected ? 'text-primary-400' : 'text-dark-500'}`}
                          />
                          {label}
                        </motion.button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Ended Overlay */}
            {error === 'ended' && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center">
                <p className="text-lg font-bold text-red-400">This event has ended</p>
                {event.endedNotificationMessage && (
                  <p className="mt-2 text-sm text-red-300/70">{event.endedNotificationMessage}</p>
                )}
                <button
                  onClick={() => navigate('/activities')}
                  className="mt-4 rounded-xl bg-primary-500 px-6 py-2.5 text-sm font-bold text-white"
                >
                  Browse Activities
                </button>
              </div>
            )}

            {/* Packages Grid */}
            {error !== 'ended' && visiblePackages.length > 0 && (
              <div>
                <h2 className="mb-3 text-lg font-bold">Packages</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visiblePackages.map((pkg) => {
                    const qty = selectedPackages.get(pkg.id) ?? 0
                    const freeCount = packageDiscountResult.freeByPackage.get(pkg.id) ?? 0
                    const total = calculatePackageTotal(pkg)
                    return (
                      <motion.div
                        key={pkg.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`relative overflow-hidden rounded-2xl border p-4 transition ${
                          qty > 0
                            ? 'border-primary-500/50 bg-dark-800/80'
                            : 'border-white/10 bg-dark-900/70 hover:border-white/20'
                        }`}
                      >
                        {qty > 0 && (
                          <div className="absolute right-2 top-2 rounded-lg bg-primary-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                            {qty} IN CART
                          </div>
                        )}

                        {freeCount > 0 && (
                          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-lg bg-green-500 px-2 py-0.5 text-[10px] font-black uppercase">
                            <Gift className="h-3 w-3" />
                            {freeCount} FREE
                          </div>
                        )}

                        <div className={qty > 0 || freeCount > 0 ? 'mt-6' : ''}>
                          <p className="text-sm font-bold uppercase tracking-wider text-secondary-400">
                            {pkg.title || 'Package'}
                          </p>
                          <p className="mt-2 min-h-10 text-xs leading-relaxed text-dark-300">
                            {pkg.items
                              .map((it) => it.name)
                              .filter(Boolean)
                              .join(' · ') || 'No items'}
                          </p>
                          <p className="mt-1 text-[11px] text-dark-500">
                            {pkg.items.length} item{pkg.items.length === 1 ? '' : 's'}
                          </p>
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xl font-bold text-white">
                            {formatCurrency(total)}
                          </span>
                          {qty === 0 ? (
                            <button
                              type="button"
                              onClick={() => incPackage(pkg.id)}
                              className="flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-primary-600"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Remove ${pkg.title || 'Package'}`}
                                onClick={() => decPackage(pkg.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-dark-800 text-sm transition hover:bg-dark-700"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="min-w-[24px] text-center text-sm font-bold">
                                {qty}
                              </span>
                              <button
                                type="button"
                                aria-label={`Add ${pkg.title || 'Package'}`}
                                onClick={() => incPackage(pkg.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-500 text-sm transition hover:bg-primary-600"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Game Cards Grid */}
            {error !== 'ended' && (event.games?.length ?? 0) > 0 && (
              <div>
                <h2 className="mb-3 text-lg font-bold">Select Games</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(event.games ?? []).map((game) => {
                    const qty = selections.get(game.activityId) ?? 0
                    const eventPrice = getEventGamePrice(game, event.offer ?? null)
                    const hasDiscount = eventPrice < game.originalPrice
                    const freeQty = cartSummary.freeByGame.get(game.activityId) ?? 0

                    return (
                      <motion.div
                        key={game.activityId}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`relative overflow-hidden rounded-2xl border p-4 transition ${
                          qty > 0
                            ? 'border-primary-500/50 bg-dark-800/80'
                            : 'border-white/10 bg-dark-900/70 hover:border-white/20'
                        }`}
                      >
                        {qty > 0 && (
                          <div className="absolute right-2 top-2 rounded-lg bg-primary-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">
                            {qty} IN CART
                          </div>
                        )}

                        {freeQty > 0 && (
                          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-lg bg-green-500 px-2 py-0.5 text-[10px] font-black uppercase">
                            <Gift className="h-3 w-3" />
                            {freeQty} FREE
                          </div>
                        )}

                        <div className={freeQty > 0 || qty > 0 ? 'mt-5' : ''}>
                          <p className="text-sm font-bold">{game.gameName}</p>
                          <p className="mt-0.5 text-xs text-dark-400">{game.variantLabel}</p>

                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-base font-bold text-secondary-400">
                              {formatCurrency(eventPrice)}
                            </span>
                            {hasDiscount && (
                              <span className="text-xs text-dark-500 line-through">
                                {formatCurrency(game.originalPrice)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Remove ${game.gameName}`}
                            onClick={() => handleRemove(game.activityId)}
                            disabled={qty === 0}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-dark-800 text-sm transition hover:bg-dark-700 disabled:opacity-30"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-[24px] text-center text-sm font-bold">{qty}</span>
                          <button
                            type="button"
                            onClick={() => handleAdd(game.activityId)}
                            className="flex h-8 items-center gap-1 rounded-full bg-primary-500 px-3 text-xs font-bold transition hover:bg-primary-600"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add
                          </button>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            )}

            {error !== 'ended' &&
              (event.games?.length ?? 0) === 0 &&
              (event.packages?.length ?? 0) === 0 && (
                <div className="rounded-2xl border border-white/10 bg-dark-900/70 p-8 text-center">
                  <p className="text-sm text-dark-400">Games coming soon for this event.</p>
                </div>
              )}
          </div>

          {/* Right Column — Cart Summary (desktop) */}
          {error !== 'ended' && (
            <div className="mt-6 hidden lg:sticky lg:top-4 lg:mt-0 lg:block lg:self-start">
              <div className="rounded-2xl border border-white/10 bg-dark-900/90 p-5 backdrop-blur-xl">
                <h3 className="text-sm font-bold uppercase tracking-wider text-dark-400">
                  Cart Summary
                </h3>

                {totalItems === 0 ? (
                  <p className="mt-3 text-sm text-dark-500">
                    Select games or a package to get started.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {selectedPackagesList.map(({ pkg, quantity }) => {
                      const unit = calculatePackageTotal(pkg)
                      const freeCount = packageDiscountResult.freeByPackage.get(pkg.id) ?? 0
                      const paidCount = quantity - freeCount
                      return (
                        <div
                          key={`pkg-${pkg.id}`}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{pkg.title || 'Package'}</p>
                            <p className="text-xs text-dark-500">
                              {paidCount > 0 && `${paidCount} × ${formatCurrency(unit)}`}
                              {freeCount > 0 && (
                                <span className="ml-1 font-bold text-green-400">
                                  +{freeCount} FREE
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="font-bold">{formatCurrency(unit * paidCount)}</span>
                        </div>
                      )
                    })}

                    {(event.games ?? []).map((game) => {
                      const qty = selections.get(game.activityId) ?? 0
                      if (qty === 0) return null
                      const price = getEventGamePrice(game, event.offer ?? null)
                      const freeQty = cartSummary.freeByGame.get(game.activityId) ?? 0
                      const paidQty = qty - freeQty
                      return (
                        <div
                          key={game.activityId}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{game.gameName}</p>
                            <p className="text-xs text-dark-500">
                              {paidQty > 0 && `${paidQty} × ${formatCurrency(price)}`}
                              {freeQty > 0 && (
                                <span className="ml-1 font-bold text-green-400">
                                  +{freeQty} FREE
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="font-bold">{formatCurrency(price * paidQty)}</span>
                        </div>
                      )
                    })}

                    <div className="border-t border-white/10 pt-2">
                      {cartSummary.savings > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-dark-400">Savings</span>
                          <span className="font-bold text-green-400">
                            -{formatCurrency(cartSummary.savings)}
                          </span>
                        </div>
                      )}
                      {packageDiscountResult.bxgyFreeValue > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-dark-400">Package offer</span>
                          <span className="font-bold text-green-400">
                            -{formatCurrency(packageDiscountResult.bxgyFreeValue)}
                          </span>
                        </div>
                      )}
                      {packageDiscountResult.flatValue > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-dark-400">Flat discount</span>
                          <span className="font-bold text-green-400">
                            -{formatCurrency(packageDiscountResult.flatValue)}
                          </span>
                        </div>
                      )}
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-sm font-bold">Total</span>
                        <span className="text-lg font-bold text-secondary-400">
                          {formatCurrency(cartSummary.total + packageDiscountResult.total)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={handleProceed}
                      className="mt-3 w-full rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 py-3.5 text-sm font-bold text-white shadow-lg transition hover:shadow-primary-500/30 disabled:opacity-50"
                    >
                      <ShoppingCart className="mr-2 inline h-4 w-4" />
                      Proceed to Cart
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating CTA (mobile) */}
      <AnimatePresence>
        {error !== 'ended' && totalItems > 0 && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
          >
            <div className="bg-gradient-to-t from-dark-950 via-dark-950/95 to-transparent px-4 pb-4 pt-8">
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleProceed}
                className="flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-primary-500 to-primary-600 px-5 py-4 shadow-lg disabled:opacity-50"
              >
                <div className="text-left">
                  <p className="text-xs text-white/70">{totalItems} items</p>
                  <p className="text-lg font-bold">
                    {formatCurrency(cartSummary.total + packageDiscountResult.total)}
                  </p>
                </div>
                <div className="flex items-center gap-2 font-bold">
                  <ShoppingCart className="h-4 w-4" />
                  Proceed to Cart
                </div>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default EventPage
