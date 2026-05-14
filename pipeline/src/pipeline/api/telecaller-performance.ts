import {
  TelecallerIncentiveConfig,
  TelecallerMonthlyPerformanceRecord,
  TelecallerMonthlyPlanRecord,
} from './types'
import {
  getCurrentMonthKey,
  getFirestoreTelecallerIncentiveConfig,
  getFirestoreTelecallerMonthlyPlan,
  isFirestoreTelecallerPerformanceActive,
  listFirestoreTelecallerMonthlyPerformance,
  listFirestoreTelecallerMonthlyPlans,
  normalizeMonthKey,
  updateFirestoreTelecallerIncentiveConfig,
  upsertFirestoreTelecallerMonthlyPlan,
} from './telecaller-performance-firestore'

export const telecallerPerformanceApi = {
  getCurrentMonthKey,
  normalizeMonthKey,
  listPlans(monthKey?: string): Promise<{ plans: TelecallerMonthlyPlanRecord[] }> {
    if (!isFirestoreTelecallerPerformanceActive()) {
      return Promise.resolve({ plans: [] })
    }
    return listFirestoreTelecallerMonthlyPlans(monthKey).then((plans) => ({ plans }))
  },
  getPlan(
    telecallerId: string,
    monthKey?: string,
  ): Promise<{ plan: TelecallerMonthlyPlanRecord | null }> {
    if (!isFirestoreTelecallerPerformanceActive()) {
      return Promise.resolve({ plan: null })
    }
    return getFirestoreTelecallerMonthlyPlan(telecallerId, monthKey).then((plan) => ({ plan }))
  },
  listPerformance(query?: {
    monthKey?: string
    telecallerIds?: string[]
  }): Promise<{ performance: TelecallerMonthlyPerformanceRecord[] }> {
    if (!isFirestoreTelecallerPerformanceActive()) {
      return Promise.resolve({ performance: [] })
    }
    return listFirestoreTelecallerMonthlyPerformance(query).then((performance) => ({ performance }))
  },
  savePlan(payload: {
    telecallerId: string
    monthKey: string
    targetAmount: number
    incentivePercent: number | null
    updatedBy?: string
  }): Promise<{ plan: TelecallerMonthlyPlanRecord }> {
    if (!isFirestoreTelecallerPerformanceActive()) {
      return Promise.reject(new Error('Firestore telecaller performance is not configured.'))
    }
    return upsertFirestoreTelecallerMonthlyPlan(payload).then((plan) => ({ plan }))
  },
  getGlobalConfig(): Promise<{ config: TelecallerIncentiveConfig }> {
    if (!isFirestoreTelecallerPerformanceActive()) {
      return Promise.reject(new Error('Firestore telecaller performance is not configured.'))
    }
    return getFirestoreTelecallerIncentiveConfig().then((config) => ({ config }))
  },
  updateGlobalConfig(payload: {
    defaultIncentivePercent: number
    updatedBy?: string
  }): Promise<{ config: TelecallerIncentiveConfig }> {
    if (!isFirestoreTelecallerPerformanceActive()) {
      return Promise.reject(new Error('Firestore telecaller performance is not configured.'))
    }
    return updateFirestoreTelecallerIncentiveConfig(payload).then((config) => ({ config }))
  },
}
