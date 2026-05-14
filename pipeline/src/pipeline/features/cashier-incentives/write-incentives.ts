/**
 * write-incentives.ts
 *
 * Called at billing time (after booking document is written) to evaluate
 * each item for cashier incentive qualification and write records to
 * the cashierIncentives collection.
 *
 * Non-critical: failures are caught by the caller and do not block
 * the booking flow.
 */

import type { Firestore } from 'firebase/firestore'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import type { BillingItem } from '../../../types'
import type { CashierIncentiveRecord, IncentiveConfig, WeeklyGameReport } from '../../api/types'
import {
  DEFAULT_INCENTIVE_CONFIG,
  writeCashierIncentiveRecord,
} from '../../api/incentives-firestore'
import {
  evaluateBookingIncentives,
  variantKey,
  type IncentiveEvaluationContext,
  type IncentiveItemInput,
} from './calculate-incentive'
import { getCurrentWeekKey } from './week-utils'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WriteCashierIncentivesParams {
  bookingId: string
  invoiceNumber: string
  locationId: string
  cashierId: string
  cashierName: string
  billingItems: BillingItem[]
  transactionDate: string
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function writeCashierIncentives(
  firestore: Firestore,
  params: WriteCashierIncentivesParams,
): Promise<void> {
  const {
    bookingId,
    invoiceNumber,
    locationId,
    cashierId,
    cashierName,
    billingItems,
    transactionDate,
  } = params

  if (!billingItems.length) return

  // Load incentive config
  let config: IncentiveConfig = { ...DEFAULT_INCENTIVE_CONFIG }
  try {
    const configSnap = await getDoc(doc(firestore, 'incentiveConfig', 'global'))
    if (configSnap.exists()) {
      const data = configSnap.data() as Record<string, unknown>
      config = {
        defaultMultiplier: Number(data.defaultMultiplier ?? config.defaultMultiplier),
        globalMultiplier: data.globalMultiplier != null ? Number(data.globalMultiplier) : null,
        incentivePercent: Number(data.incentivePercent ?? config.incentivePercent),
        goKartLapThreshold: Number(data.goKartLapThreshold ?? config.goKartLapThreshold),
        perGameOverrides: (data.perGameOverrides as IncentiveConfig['perGameOverrides']) ?? {},
        updatedAt: String(data.updatedAt ?? ''),
        updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
      }
    }
  } catch {
    /* use defaults */
  }

  // Build the evaluation context
  const weekKey = getCurrentWeekKey()
  const nonPerformingVariants = new Set<string>()
  const goKartVariantLaps = new Map<string, number>()

  // Try to load the current week's report for non-performing data
  let weeklyReport: WeeklyGameReport | null = null
  try {
    const reportSnap = await getDoc(doc(firestore, 'weeklyGameReports', weekKey))
    if (reportSnap.exists()) {
      weeklyReport = reportSnap.data() as WeeklyGameReport
    }
  } catch {
    /* proceed without report */
  }

  if (weeklyReport) {
    // Use the weekly report snapshot
    const locationData = weeklyReport.locationReports[locationId]
    if (locationData) {
      for (const g of locationData.games) {
        const key = variantKey(g.gameId, g.subGameId, g.variantId)
        if (g.isNonPerforming) {
          nonPerformingVariants.add(key)
        }
        if (g.laps != null) {
          goKartVariantLaps.set(key, g.laps)
        }
      }
    }
  } else {
    // No weekly report yet — fall back to live threshold calculation
    // Load variant data from the activity hierarchy for this location
    try {
      const gamesCol = collection(firestore, 'locations', locationId, 'games')
      const gamesSnap = await getDocs(gamesCol)

      for (const gameDoc of gamesSnap.docs) {
        const gameData = gameDoc.data()
        if (gameData.status === 'Inactive') continue

        const subGamesCol = collection(
          firestore,
          'locations',
          locationId,
          'games',
          gameDoc.id,
          'subgames',
        )
        const subGamesSnap = await getDocs(subGamesCol)

        for (const sgDoc of subGamesSnap.docs) {
          const variantsCol = collection(
            firestore,
            'locations',
            locationId,
            'games',
            gameDoc.id,
            'subgames',
            sgDoc.id,
            'variants',
          )
          const variantsSnap = await getDocs(variantsCol)

          for (const vDoc of variantsSnap.docs) {
            const vData = vDoc.data()
            if (vData.active === false) continue

            const key = variantKey(gameDoc.id, sgDoc.id, vDoc.id)
            const overKey = `${locationId}_${gameDoc.id}_${sgDoc.id}_${vDoc.id}`

            // Check if excluded
            const override = config.perGameOverrides[overKey]
            if (override?.excluded) continue

            // For live fallback, we can't compute weekly revenue at billing time.
            // Instead, we query the current week's bookings for this variant.
            // To keep billing fast, we'll mark ALL variants as potentially non-performing
            // and let the weekly report be the definitive source.
            // Since we don't have revenue data, use a conservative approach:
            // only apply non-performing if the threshold is very low (price=0) or
            // if a weekly report exists. Without a report, skip non-performing rule.
            // GoKart laps rule still applies.

            if (typeof vData.laps === 'number') {
              goKartVariantLaps.set(key, vData.laps)
            }
          }
        }
      }
    } catch {
      /* proceed with GoKart-only evaluation */
    }
  }

  const ctx: IncentiveEvaluationContext = {
    weekKey,
    nonPerformingVariants,
    goKartVariantLaps,
    incentivePercent: config.incentivePercent,
    goKartLapThreshold: config.goKartLapThreshold,
  }

  // Convert billing items to evaluation input
  const evalItems: IncentiveItemInput[] = billingItems.map((bi) => ({
    itemName: bi.itemName,
    quantity: bi.quantity,
    unitPrice: bi.unitPrice,
    gameId: bi.gameId,
    subGameId: bi.subGameId,
    variantId: bi.variantId,
    itemBaseAmount: bi.itemBaseAmount,
    itemGstAmount: bi.itemGstAmount,
  }))

  const results = evaluateBookingIncentives(evalItems, ctx)

  // Write qualifying incentive records
  const now = new Date().toISOString()
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (!result.qualifies || result.incentiveAmount <= 0) continue

    const item = billingItems[i]
    const isComboItem = item.itemName.includes(' — ')

    const record: CashierIncentiveRecord = {
      id: `${bookingId}_${i}`,
      bookingId,
      invoiceNumber,
      locationId,
      cashierId,
      cashierName,
      itemIndex: i,
      itemName: item.itemName,
      gameId: item.gameId ?? '',
      subGameId: item.subGameId ?? '',
      variantId: item.variantId ?? '',
      itemAmount: result.itemAmount,
      incentivePercent: config.incentivePercent,
      incentiveAmount: result.incentiveAmount,
      reason: result.reason!,
      laps: result.laps,
      weeklyRevenue: null,
      threshold: null,
      weekKey,
      isComboItem,
      comboName: isComboItem ? item.itemName.split(' — ')[0] : null,
      status: 'active',
      reversedAt: null,
      reversedReason: null,
      createdAt: now,
      transactionDate,
    }

    // Populate weekly revenue and threshold from report if available
    if (weeklyReport) {
      const locReport = weeklyReport.locationReports[locationId]
      if (locReport) {
        const match = locReport.games.find(
          (g) =>
            g.gameId === item.gameId &&
            g.subGameId === item.subGameId &&
            g.variantId === item.variantId,
        )
        if (match) {
          record.weeklyRevenue = match.weeklyRevenue
          record.threshold = match.threshold
        }
      }
    }

    await writeCashierIncentiveRecord(record)
  }
}
