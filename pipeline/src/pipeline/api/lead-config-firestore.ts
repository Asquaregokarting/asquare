import { doc, getDoc, setDoc } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import type { LeadAutomationConfig } from './types'
import { DEFAULT_AUTOMATION_CONFIG } from '../features/leads/lead-constants'

const CONFIG_COLLECTION = 'leadConfig'
const CONFIG_DOC_ID = 'automation'

const getConfigRef = () => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  return doc(firestore, CONFIG_COLLECTION, CONFIG_DOC_ID)
}

export const getLeadAutomationConfig = async (): Promise<LeadAutomationConfig> => {
  try {
    const snap = await getDoc(getConfigRef())
    if (!snap.exists()) return { ...DEFAULT_AUTOMATION_CONFIG }
    const data = snap.data() as Record<string, unknown>
    return {
      noAnswerWhatsappThreshold: Number(
        data.noAnswerWhatsappThreshold ?? DEFAULT_AUTOMATION_CONFIG.noAnswerWhatsappThreshold,
      ),
      autoCloseInactiveDays: Number(
        data.autoCloseInactiveDays ?? DEFAULT_AUTOMATION_CONFIG.autoCloseInactiveDays,
      ),
      abandonedCartHours: Number(
        data.abandonedCartHours ?? DEFAULT_AUTOMATION_CONFIG.abandonedCartHours,
      ),
      autoScoreWeights: {
        recencyWeight: Number(
          (data.autoScoreWeights as Record<string, unknown>)?.recencyWeight ??
            DEFAULT_AUTOMATION_CONFIG.autoScoreWeights.recencyWeight,
        ),
        frequencyWeight: Number(
          (data.autoScoreWeights as Record<string, unknown>)?.frequencyWeight ??
            DEFAULT_AUTOMATION_CONFIG.autoScoreWeights.frequencyWeight,
        ),
        spendWeight: Number(
          (data.autoScoreWeights as Record<string, unknown>)?.spendWeight ??
            DEFAULT_AUTOMATION_CONFIG.autoScoreWeights.spendWeight,
        ),
        channelWeight: Number(
          (data.autoScoreWeights as Record<string, unknown>)?.channelWeight ??
            DEFAULT_AUTOMATION_CONFIG.autoScoreWeights.channelWeight,
        ),
      },
      scoreThresholds: {
        hotMin: Number(
          (data.scoreThresholds as Record<string, unknown>)?.hotMin ??
            DEFAULT_AUTOMATION_CONFIG.scoreThresholds.hotMin,
        ),
        warmMin: Number(
          (data.scoreThresholds as Record<string, unknown>)?.warmMin ??
            DEFAULT_AUTOMATION_CONFIG.scoreThresholds.warmMin,
        ),
      },
      enableAutoWhatsapp: Boolean(
        data.enableAutoWhatsapp ?? DEFAULT_AUTOMATION_CONFIG.enableAutoWhatsapp,
      ),
      enableAutoClose: Boolean(data.enableAutoClose ?? DEFAULT_AUTOMATION_CONFIG.enableAutoClose),
      enableAutoAssign: Boolean(
        data.enableAutoAssign ?? DEFAULT_AUTOMATION_CONFIG.enableAutoAssign,
      ),
      leadsPageSize: Number(data.leadsPageSize ?? DEFAULT_AUTOMATION_CONFIG.leadsPageSize),
      freshLeadWindowSeconds: Number(
        data.freshLeadWindowSeconds ?? DEFAULT_AUTOMATION_CONFIG.freshLeadWindowSeconds,
      ),
    }
  } catch {
    return { ...DEFAULT_AUTOMATION_CONFIG }
  }
}

export const updateLeadAutomationConfig = async (
  token: string,
  patch: Partial<LeadAutomationConfig>,
): Promise<LeadAutomationConfig> => {
  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only admins can update lead automation config.')
  }
  const current = await getLeadAutomationConfig()
  const updated: LeadAutomationConfig = {
    ...current,
    ...patch,
    autoScoreWeights: { ...current.autoScoreWeights, ...patch.autoScoreWeights },
    scoreThresholds: { ...current.scoreThresholds, ...patch.scoreThresholds },
  }
  await setDoc(getConfigRef(), updated)
  return updated
}
