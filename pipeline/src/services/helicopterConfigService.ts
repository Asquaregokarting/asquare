import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logger } from '../lib/logger'

export interface HelicopterPublicConfig {
  enabled: boolean
  branchEnabled: Record<string, boolean>
}

const CONFIG_REF = doc(db, 'helicopterConfig', 'global')

const DEFAULT_CONFIG: HelicopterPublicConfig = {
  enabled: true,
  branchEnabled: {},
}

let cache: HelicopterPublicConfig | null = null
let inflight: Promise<HelicopterPublicConfig> | null = null

const parse = (data: Record<string, unknown> | undefined): HelicopterPublicConfig => ({
  enabled: data?.enabled !== false,
  branchEnabled: (data?.branchEnabled as Record<string, boolean>) ?? {},
})

export async function getHelicopterPublicConfig(): Promise<HelicopterPublicConfig> {
  if (cache) return cache
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const snap = await getDoc(CONFIG_REF)
      const config = snap.exists() ? parse(snap.data() as Record<string, unknown>) : DEFAULT_CONFIG
      cache = config
      return config
    } catch (err) {
      logger.warn('helicopter.config.read_failed', { err: String(err) })
      return DEFAULT_CONFIG
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export function subscribeHelicopterPublicConfig(
  listener: (config: HelicopterPublicConfig) => void,
): () => void {
  return onSnapshot(
    CONFIG_REF,
    (snap) => {
      const config = snap.exists() ? parse(snap.data() as Record<string, unknown>) : DEFAULT_CONFIG
      cache = config
      listener(config)
    },
    (err) => {
      logger.warn('helicopter.config.subscribe_failed', { err: String(err) })
      listener(DEFAULT_CONFIG)
    },
  )
}

export function isBranchEnabled(config: HelicopterPublicConfig, branchId: string): boolean {
  if (!config.enabled) return false
  return config.branchEnabled[branchId] !== false
}
